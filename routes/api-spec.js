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
const Comment = require('../models/Comment');
const mongoose = require('mongoose');

const router = express.Router();
const TOKEN_SECRET = process.env.JWT_SECRET || 'change-this-secret';

const successResponse = (res, message, data = null, status = 200, pagination = null) => {
  const response = { success: true, message, data };
  if (pagination) Object.assign(response, pagination);
  return res.status(status).json(response);
};

const errorResponse = (res, message, status = 500) => {
  return res.status(status).json({ success: false, message });
};

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return errorResponse(res, 'Validation failed: ' + errors.array().map(e => e.msg).join(', '), 400);
  }
  next();
};

const generateId = (prefix) => `${prefix}${Date.now().toString().slice(-8)}`;

router.get('/health', async (req, res) => {
  try {
    const documentCount = await mongoose.connection.db.collection('users').countDocuments();
    return successResponse(res, 'Database connected successfully', {
      database: 'connected',
      documentCount,
    });
  } catch (err) {
    return errorResponse(res, 'Database connection failed', 500);
  }
});

router.post('/auth/register', [
  body('name').trim().isLength({ min: 2 }).withMessage('Name required'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be 6+ characters'),
], handleValidation, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return errorResponse(res, 'Email already registered', 400);
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = generateId('USR');
    const user = await User.create({ userId, name, email, passwordHash });
    return successResponse(res, 'Registration successful', user, 201);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/auth/login', [
  body('email').isEmail(),
  body('password').exists(),
], handleValidation, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return errorResponse(res, 'Invalid credentials', 401);
    }
    const token = jwt.sign({ id: user._id }, TOKEN_SECRET, { expiresIn: '8h' });
    return successResponse(res, 'Login successful', { token, user });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/auth/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    return successResponse(res, 'User fetched', user);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/sync', authenticate, authorize('admin'), async (req, res) => {
  try {
    const loginRes = await axios.post('https://t4e-testserver.onrender.com/api/login', {
      studentId: 'E0423032',
      password: '731804',
    }, { timeout: 10000 });
    const token = loginRes.data.token;
    if (!token) return errorResponse(res, 'Failed to get token', 400);
    
    const dataRes = await axios.get('https://t4e-testserver.onrender.com/api/dataset', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    
    const dataset = dataRes.data.data || dataRes.data || [];
    let inserted = 0, duplicates = 0, rejected = 0;
    
    for (const item of dataset) {
      try {
        const existing = await Issue.findOne({ issueId: item.issueId });
        if (existing) {
          duplicates++;
          continue;
        }
        const reportedBy = await User.findOne({ email: item.reporterEmail });
        if (!reportedBy) {
          rejected++;
          continue;
        }
        const project = await Project.findOne({ projectId: item.projectId });
        if (!project) {
          rejected++;
          continue;
        }
        await Issue.create({
          issueId: item.issueId,
          title: item.title,
          description: item.description || '',
          project: project._id,
          assignedTo: null,
          reportedBy: reportedBy._id,
          priority: item.priority || 'medium',
          severity: item.severity || 'major',
          status: item.status || 'open',
        });
        inserted++;
      } catch (e) {
        rejected++;
      }
    }
    
    return successResponse(res, 'Dataset synchronized successfully', {
      totalFetched: dataset.length,
      inserted,
      duplicates,
      rejected,
    });
  } catch (err) {
    return errorResponse(res, 'Sync failed: ' + err.message, 500);
  }
});

router.get('/users', authenticate, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    return successResponse(res, 'Users fetched successfully', users, 200, { total: users.length });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/users/:userId', authenticate, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) return errorResponse(res, 'User not found', 404);
    return successResponse(res, 'User fetched successfully', user);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.post('/projects', authenticate, authorize('admin', 'manager'), [
  body('title').trim().isLength({ min: 2 }),
], handleValidation, async (req, res) => {
  try {
    const { title, category, description } = req.body;
    const projectId = generateId('PROJ');
    const project = await Project.create({
      projectId,
      title,
      category: category || '',
      description: description || '',
      owner: req.user.id,
    });
    await project.populate('owner');
    return successResponse(res, 'Project created successfully', project, 201);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/projects', authenticate, async (req, res) => {
  try {
    const { status, category, search, page = 1, limit = 10 } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) filter.title = { $regex: search, $options: 'i' };
    
    const skip = (page - 1) * limit;
    const total = await Project.countDocuments(filter);
    const data = await Project.find(filter).populate('owner').skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
    
    return successResponse(res, 'Projects fetched successfully', data, 200, {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/projects/:projectId', authenticate, async (req, res) => {
  try {
    const project = await Project.findOne({ projectId: req.params.projectId }).populate('owner').populate('members');
    if (!project) return errorResponse(res, 'Project not found', 404);
    return successResponse(res, 'Project fetched successfully', project);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.patch('/projects/:projectId', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { title, category, description, members } = req.body;
    const project = await Project.findOne({ projectId: req.params.projectId });
    if (!project) return errorResponse(res, 'Project not found', 404);
    
    if (title) project.title = title;
    if (category) project.category = category;
    if (description !== undefined) project.description = description;
    if (members) project.members = members;
    
    await project.save();
    await project.populate('owner').populate('members');
    return successResponse(res, 'Project updated successfully', project);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.delete('/projects/:projectId', authenticate, authorize('admin'), async (req, res) => {
  try {
    const project = await Project.findOneAndDelete({ projectId: req.params.projectId });
    if (!project) return errorResponse(res, 'Project not found', 404);
    return successResponse(res, 'Project deleted successfully', project);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.post('/issues', authenticate, [
  body('title').trim().isLength({ min: 2 }),
  body('projectId').trim(),
], handleValidation, async (req, res) => {
  try {
    const { title, description, projectId, priority, severity, assignedTo } = req.body;
    const project = await Project.findOne({ projectId });
    if (!project) return errorResponse(res, 'Project not found', 404);
    
    const issueId = generateId('ISS');
    const issue = await Issue.create({
      issueId,
      title,
      description: description || '',
      project: project._id,
      assignedTo: assignedTo || null,
      reportedBy: req.user.id,
      priority: priority || 'medium',
      severity: severity || 'major',
    });
    await issue.populate('project').populate('assignedTo').populate('reportedBy');
    return successResponse(res, 'Issue created successfully', issue, 201);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/issues', authenticate, async (req, res) => {
  try {
    const { status, priority, severity, search, page = 1, limit = 10 } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (severity) filter.severity = severity;
    if (search) filter.title = { $regex: search, $options: 'i' };
    
    const skip = (page - 1) * limit;
    const total = await Issue.countDocuments(filter);
    const data = await Issue.find(filter).populate('project').populate('assignedTo').populate('reportedBy').skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
    
    return successResponse(res, 'Issues fetched successfully', data, 200, {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/issues/:issueId', authenticate, async (req, res) => {
  try {
    const issue = await Issue.findOne({ issueId: req.params.issueId }).populate('project').populate('assignedTo').populate('reportedBy');
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    return successResponse(res, 'Issue fetched successfully', issue);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.patch('/issues/:issueId', authenticate, async (req, res) => {
  try {
    const { title, description, priority, severity } = req.body;
    const issue = await Issue.findOne({ issueId: req.params.issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    
    if (title) issue.title = title;
    if (description !== undefined) issue.description = description;
    if (priority) issue.priority = priority;
    if (severity) issue.severity = severity;
    
    await issue.save();
    await issue.populate('project').populate('assignedTo').populate('reportedBy');
    return successResponse(res, 'Issue updated successfully', issue);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.delete('/issues/:issueId', authenticate, authorize('admin'), async (req, res) => {
  try {
    const issue = await Issue.findOneAndDelete({ issueId: req.params.issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    return successResponse(res, 'Issue deleted successfully', issue);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.patch('/issues/:issueId/assign', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { userId } = req.body;
    const issue = await Issue.findOne({ issueId: req.params.issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    
    const user = await User.findOne({ userId });
    if (!user) return errorResponse(res, 'User not found', 404);
    
    issue.assignedTo = user._id;
    await issue.save();
    await issue.populate('project').populate('assignedTo').populate('reportedBy');
    return successResponse(res, 'Issue assigned successfully', issue);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.patch('/issues/:issueId/status', authenticate, async (req, res) => {
  try {
    const { newStatus } = req.body;
    const issue = await Issue.findOne({ issueId: req.params.issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    
    const previousStatus = issue.status;
    issue.status = newStatus;
    await issue.save();
    
    return successResponse(res, 'Issue status updated successfully', {
      issueId: issue.issueId,
      previousStatus,
      newStatus: issue.status,
    });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.post('/comments', authenticate, [
  body('issueId').trim(),
  body('message').trim().isLength({ min: 1 }),
], handleValidation, async (req, res) => {
  try {
    const { issueId, message } = req.body;
    const issue = await Issue.findOne({ issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    
    const commentId = generateId('COM');
    const comment = await Comment.create({
      commentId,
      issue: issue._id,
      user: req.user.id,
      message,
    });
    await comment.populate('issue').populate('user');
    return successResponse(res, 'Comment added successfully', comment, 201);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/comments', authenticate, async (req, res) => {
  try {
    const { issueId, search, page = 1, limit = 10 } = req.query;
    let filter = {};
    if (issueId) {
      const issue = await Issue.findOne({ issueId });
      if (issue) filter.issue = issue._id;
    }
    if (search) filter.message = { $regex: search, $options: 'i' };
    
    const skip = (page - 1) * limit;
    const total = await Comment.countDocuments(filter);
    const data = await Comment.find(filter).populate('issue').populate('user').skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
    
    return successResponse(res, 'Comments fetched successfully', data, 200, {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/comments/:commentId', authenticate, async (req, res) => {
  try {
    const comment = await Comment.findOne({ commentId: req.params.commentId }).populate('issue').populate('user');
    if (!comment) return errorResponse(res, 'Comment not found', 404);
    return successResponse(res, 'Comment fetched successfully', comment);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.delete('/comments/:commentId', authenticate, async (req, res) => {
  try {
    const comment = await Comment.findOneAndDelete({ commentId: req.params.commentId });
    if (!comment) return errorResponse(res, 'Comment not found', 404);
    return successResponse(res, 'Comment deleted successfully', comment);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/analytics/issues', authenticate, async (req, res) => {
  try {
    const totalIssues = await Issue.countDocuments();
    const openIssues = await Issue.countDocuments({ status: 'open' });
    const inProgressIssues = await Issue.countDocuments({ status: 'in-progress' });
    const testingIssues = await Issue.countDocuments({ status: 'testing' });
    const resolvedIssues = await Issue.countDocuments({ status: 'resolved' });
    const closedIssues = await Issue.countDocuments({ status: 'closed' });
    
    return successResponse(res, 'Issue analytics fetched successfully', {
      totalIssues,
      openIssues,
      inProgressIssues,
      testingIssues,
      resolvedIssues,
      closedIssues,
    });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/analytics/projects', authenticate, async (req, res) => {
  try {
    const activeProjects = await Project.countDocuments({ status: 'active' });
    const completedProjects = await Project.countDocuments({ status: 'completed' });
    const archivedProjects = await Project.countDocuments({ status: 'archived' });
    
    const projects = await Project.aggregate([
      { $lookup: { from: 'issues', localField: '_id', foreignField: 'project', as: 'issues' } },
      { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'ownerData' } },
      { $project: { projectId: 1, title: 1, status: 1, issueCount: { $size: '$issues' }, owner: { $arrayElemAt: ['$ownerData.name', 0] } } },
    ]);
    
    return successResponse(res, 'Project analytics fetched successfully', {
      activeProjects,
      completedProjects,
      archivedProjects,
      projects,
    });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.get('/analytics/developers', authenticate, async (req, res) => {
  try {
    const developers = await Issue.aggregate([
      { $match: { assignedTo: { $ne: null } } },
      { $group: { _id: '$assignedTo', assignedIssues: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $project: { userId: { $arrayElemAt: ['$user.userId', 0] }, name: { $arrayElemAt: ['$user.name', 0] }, assignedIssues: 1, resolvedIssues: '$resolved' } },
      { $sort: { resolvedIssues: -1 } },
    ]);
    
    const highestResolvedDeveloper = developers[0] || null;
    
    return successResponse(res, 'Developer analytics fetched successfully', {
      highestResolvedDeveloper,
      developers,
    });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

module.exports = router;
