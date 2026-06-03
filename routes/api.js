const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const validator = require('validator');
const { authenticate, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Project = require('../models/Project');
const Issue = require('../models/Issue');
const Assignment = require('../models/Assignment');
const Comment = require('../models/Comment');

const router = express.Router();
const TOKEN_SECRET = process.env.JWT_SECRET || 'change-this-secret';

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const toApiObject = (doc) => {
  if (!doc) return null;
  const object = doc.toObject({ getters: true });
  object.id = object._id;
  delete object._id;
  delete object.__v;
  return object;
};

const buildToken = (user) => jwt.sign({ id: user._id, email: user.email, role: user.role }, TOKEN_SECRET, { expiresIn: '8h' });

const normalizeStatus = (value) => {
  if (!value || typeof value !== 'string') return 'open';
  const sanitized = value.toLowerCase().trim();
  if (['open', 'in-progress', 'closed'].includes(sanitized)) return sanitized;
  return 'open';
};

const sanitizeText = (value) => (typeof value === 'string' ? validator.escape(value.trim()) : '');

const findOrCreateImportedUser = async (email, name) => {
  const normalizedEmail = validator.normalizeEmail(String(email || '').trim());
  if (!validator.isEmail(normalizedEmail)) {
    return null;
  }
  let user = await User.findOne({ email: normalizedEmail });
  if (user) return user;
  const randomPassword = Math.random().toString(36).slice(-8) + Date.now();
  const passwordHash = await bcrypt.hash(randomPassword, 10);
  const displayName = sanitizeText(name) || normalizedEmail.split('@')[0];
  user = await User.create({
    name: displayName,
    email: normalizedEmail,
    passwordHash,
    role: 'developer',
  });
  return user;
};

router.post(
  '/auth/register',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['admin', 'manager', 'developer']),
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { name, email, password, role: requestedRole } = req.body;
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({ error: 'Email is already registered' });
      }

      let role = 'developer';
      if (requestedRole === 'admin') {
        const userCount = await User.estimatedDocumentCount();
        if (userCount === 0) {
          role = 'admin';
        } else {
          return res.status(403).json({ error: 'Admin registration is only allowed when no users exist' });
        }
      } else if (requestedRole === 'manager') {
        role = 'manager';
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const newUser = await User.create({ name: sanitizeText(name), email, passwordHash, role });
      return res.json({ id: newUser._id, name: newUser.name, email: newUser.email, role: newUser.role });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  '/auth/login',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').exists().withMessage('Password is required'),
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email }).select('+passwordHash');
      if (!user) {
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      const token = buildToken(user);
      return res.json({ token, user: toApiObject(user) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

router.use(authenticate);

router.get('/me', (req, res) => {
  return res.json(toApiObject(req.user));
});

router.get('/users', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    return res.json(users.map(toApiObject));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  '/users',
  authorize('admin'),
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['admin', 'manager', 'developer']).withMessage('Role is invalid'),
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { name, email, password, role } = req.body;
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({ error: 'Email is already registered' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const newUser = await User.create({ name: sanitizeText(name), email, passwordHash, role });
      return res.json(toApiObject(newUser));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

router.get('/projects', async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 });
    return res.json(projects.map(toApiObject));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  '/projects',
  authorize('admin', 'manager'),
  [body('name').trim().isLength({ min: 2 }).withMessage('Project name is required'), body('description').optional().trim()],
  handleValidation,
  async (req, res) => {
    try {
      const { name, description } = req.body;
      const project = await Project.create({ name: sanitizeText(name), description: sanitizeText(description || '') });
      return res.json(toApiObject(project));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

router.get('/issues', async (req, res) => {
  try {
    const issues = await Issue.find()
      .populate('projectId')
      .populate('reporterId')
      .populate('assigneeId')
      .sort({ createdAt: -1 });

    return res.json(
      issues.map((issue) => ({
        id: issue._id,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        projectId: issue.projectId?._id,
        projectName: issue.projectId?.name,
        reporterId: issue.reporterId?._id,
        reporterName: issue.reporterId?.name,
        assigneeId: issue.assigneeId?._id,
        assigneeName: issue.assigneeId?.name,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  '/issues',
  [
    body('title').trim().isLength({ min: 2 }).withMessage('Issue title is required'),
    body('projectId').isMongoId().withMessage('Valid projectId is required'),
    body('status').optional().isIn(['open', 'in-progress', 'closed']),
    body('reporterId').optional().isMongoId(),
    body('assigneeId').optional().isMongoId(),
    body('description').optional().trim(),
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { title, description, status, projectId, reporterId, assigneeId } = req.body;
      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(400).json({ error: 'Project not found' });
      }

      let resolvedReporterId = req.user._id;
      if (reporterId) {
        if (req.user.role !== 'admin' && reporterId !== String(req.user._id)) {
          return res.status(403).json({ error: 'You can only assign yourself as the reporter' });
        }
        resolvedReporterId = reporterId;
      }

      const assignee = assigneeId ? await User.findById(assigneeId) : null;
      if (assigneeId && !assignee) {
        return res.status(400).json({ error: 'Assignee user not found' });
      }

      const issue = await Issue.create({
        title: sanitizeText(title),
        description: sanitizeText(description || ''),
        status: normalizeStatus(status),
        projectId,
        reporterId: resolvedReporterId,
        assigneeId: assignee ? assignee._id : null,
      });
      return res.json({
        id: issue._id,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        projectId: issue.projectId,
        reporterId: issue.reporterId,
        assigneeId: issue.assigneeId,
        createdAt: issue.createdAt,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

router.get('/assignments', async (req, res) => {
  try {
    const assignments = await Assignment.find()
      .populate('issueId')
      .populate('userId')
      .sort({ assignedAt: -1 });
    return res.json(
      assignments.map((assignment) => ({
        id: assignment._id,
        issueId: assignment.issueId?._id,
        issueTitle: assignment.issueId?.title,
        userId: assignment.userId?._id,
        userName: assignment.userId?.name,
        assignedAt: assignment.assignedAt,
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  '/assignments',
  authorize('admin', 'manager'),
  [body('issueId').isMongoId().withMessage('Valid issueId is required'), body('userId').isMongoId().withMessage('Valid userId is required')],
  handleValidation,
  async (req, res) => {
    try {
      const { issueId, userId } = req.body;
      const issue = await Issue.findById(issueId);
      const user = await User.findById(userId);
      if (!issue || !user) {
        return res.status(400).json({ error: 'Issue or user not found' });
      }
      const assignment = await Assignment.create({ issueId, userId });
      return res.json({ id: assignment._id, issueId, userId, assignedAt: assignment.assignedAt });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

router.get('/comments', async (req, res) => {
  try {
    const comments = await Comment.find()
      .populate('issueId')
      .populate('userId')
      .sort({ createdAt: -1 });
    return res.json(
      comments.map((comment) => ({
        id: comment._id,
        issueId: comment.issueId?._id,
        issueTitle: comment.issueId?.title,
        userId: comment.userId?._id,
        userName: comment.userId?.name,
        content: comment.content,
        createdAt: comment.createdAt,
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  '/comments',
  [
    body('issueId').isMongoId().withMessage('Valid issueId is required'),
    body('userId').isMongoId().withMessage('Valid userId is required'),
    body('content').trim().isLength({ min: 1 }).withMessage('Comment content is required'),
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { issueId, userId, content } = req.body;
      const issue = await Issue.findById(issueId);
      const user = await User.findById(userId);
      if (!issue || !user) {
        return res.status(400).json({ error: 'Issue or user not found' });
      }
      const comment = await Comment.create({ issueId, userId, content: sanitizeText(content) });
      return res.json({ id: comment._id, issueId, userId, content: comment.content, createdAt: comment.createdAt });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  '/import',
  authorize('admin'),
  [body('sourceUrl').trim().isURL().withMessage('Valid sourceUrl is required')],
  handleValidation,
  async (req, res) => {
    try {
      const { sourceUrl } = req.body;
      const response = await axios.get(sourceUrl, { timeout: 10000 });
      const data = response.data;
      if (!Array.isArray(data)) {
        return res.status(400).json({ error: 'External dataset must be an array of issue records' });
      }

      const result = { importedIssues: 0, importedComments: 0, skippedRecords: 0, errors: [] };
      for (const item of data) {
        const title = sanitizeText(item.title);
        const description = sanitizeText(item.description || '');
        const projectName = sanitizeText(item.projectName || item.project || '');
        const projectDescription = sanitizeText(item.projectDescription || '');
        const reporterEmail = validator.normalizeEmail(String(item.reporterEmail || item.email || '').trim());
        const reporterName = sanitizeText(item.reporterName || item.reporter || '');
        const assigneeEmail = validator.normalizeEmail(String(item.assigneeEmail || item.assignee || '').trim());
        const assigneeName = sanitizeText(item.assigneeName || '');
        const status = normalizeStatus(item.status);

        if (!title || !projectName || !validator.isEmail(reporterEmail)) {
          result.skippedRecords += 1;
          result.errors.push({ title: title || null, reason: 'Missing title, project name, or reporter email' });
          continue;
        }

        const project = await Project.findOneAndUpdate(
          { name: projectName },
          { description: projectDescription || undefined },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const reporter = await findOrCreateImportedUser(reporterEmail, reporterName || reporterEmail.split('@')[0]);
        if (!reporter) {
          result.skippedRecords += 1;
          result.errors.push({ title, reason: 'Invalid reporter email' });
          continue;
        }

        let assignee = null;
        if (assigneeEmail && validator.isEmail(assigneeEmail)) {
          assignee = await findOrCreateImportedUser(assigneeEmail, assigneeName || assigneeEmail.split('@')[0]);
        }

        const issue = await Issue.create({
          title,
          description,
          status,
          projectId: project._id,
          reporterId: reporter._id,
          assigneeId: assignee ? assignee._id : null,
        });

        if (Array.isArray(item.comments)) {
          for (const commentItem of item.comments) {
            const content = sanitizeText(commentItem.content || commentItem.body || '');
            const commentUserEmail = validator.normalizeEmail(String(commentItem.email || commentItem.userEmail || reporterEmail).trim());
            const commentUserName = sanitizeText(commentItem.userName || commentItem.name || '');
            if (!content || !validator.isEmail(commentUserEmail)) {
              continue;
            }
            const commentUser = await findOrCreateImportedUser(commentUserEmail, commentUserName || commentUserEmail.split('@')[0]);
            if (commentUser) {
              await Comment.create({ issueId: issue._id, userId: commentUser._id, content });
              result.importedComments += 1;
            }
          }
        }

        result.importedIssues += 1;
      }

      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

router.get('/analytics/summary', authorize('admin', 'manager'), async (req, res) => {
  try {
    const [totalUsers, totalProjects, totalIssues, totalComments, openIssues, closedIssues] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
      Issue.countDocuments(),
      Comment.countDocuments(),
      Issue.countDocuments({ status: 'open' }),
      Issue.countDocuments({ status: 'closed' }),
    ]);

    const issuesByStatus = await Issue.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const projectCounts = await Issue.aggregate([
      {
        $group: {
          _id: '$projectId',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'projects',
          localField: '_id',
          foreignField: '_id',
          as: 'project',
        },
      },
      { $unwind: '$project' },
      { $project: { name: '$project.name', count: 1 } },
    ]);

    return res.json({
      totalUsers,
      totalProjects,
      totalIssues,
      totalComments,
      openIssues,
      closedIssues,
      issuesByStatus,
      topProjects: projectCounts,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const [openIssues, inProgressIssues, closedIssues, totalProjects, totalComments] = await Promise.all([
      Issue.countDocuments({ status: 'open' }),
      Issue.countDocuments({ status: 'in-progress' }),
      Issue.countDocuments({ status: 'closed' }),
      Project.countDocuments(),
      Comment.countDocuments(),
    ]);
    return res.json({ openIssues, inProgressIssues, closedIssues, totalProjects, totalComments });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/fetch-external-token', async (req, res) => {
  try {
    const studentId = 'E0423032';
    const password = '731804';
    const response = await axios.post('https://t4e-testserver.onrender.com/api/login', {
      studentId,
      password,
    }, { timeout: 10000 });
    const tokenData = response.data;
    return res.json({ token: tokenData.token || tokenData.data?.token, message: 'Token fetched successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch token from external server: ' + err.message });
  }
});

router.get('/fetch-external-dataset', async (req, res) => {
  try {
    const studentId = 'E0423032';
    const password = '731804';
    const loginRes = await axios.post('https://t4e-testserver.onrender.com/api/login', {
      studentId,
      password,
    }, { timeout: 10000 });
    const token = loginRes.data.token || loginRes.data.data?.token;
    if (!token) {
      return res.status(400).json({ error: 'Could not obtain token from external server' });
    }
    const dataRes = await axios.get('https://t4e-testserver.onrender.com/api/dataset', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    return res.json({ dataset: dataRes.data, token });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch external dataset: ' + err.message });
  }
});

module.exports = router;
