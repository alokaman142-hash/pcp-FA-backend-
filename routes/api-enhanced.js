const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { authenticate, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Project = require('../models/Project');
const Issue = require('../models/Issue');
const Comment = require('../models/Comment');
const mongoose = require('mongoose');
const PersistenceManager = require('../utils/PersistenceManager');
const {
  validateUserRegistration,
  validateUserLogin,
  validateProjectCreation,
  validateProjectUpdate,
  validateIssueCreation,
  validateIssueUpdate,
  validateCommentCreation,
  validatePaginationParams,
  validateAssignIssue,
  validateChangeIssueStatus,
} = require('../middleware/validation');

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

const generateId = (prefix) => `${prefix}${Date.now().toString().slice(-8)}`;

// HEALTH ENDPOINT
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

// AUTHENTICATION ENDPOINTS
router.post('/auth/register', validateUserRegistration, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const userId = generateId('USR');
    const user = await PersistenceManager.validateAndPersistUser({
      userId,
      name,
      email,
      passwordHash: password,
    });
    return successResponse(res, 'Registration successful', user.toJSON(), 201);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/auth/login', validateUserLogin, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !await user.comparePassword(password)) {
      return errorResponse(res, 'Invalid credentials', 401);
    }
    user.lastLogin = new Date();
    await user.save();
    const token = jwt.sign({ id: user._id }, TOKEN_SECRET, { expiresIn: '8h' });
    return successResponse(res, 'Login successful', { token, user: user.toJSON() });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/auth/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    return successResponse(res, 'User fetched', user.toJSON());
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

// SYNC ENDPOINT
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
        await PersistenceManager.validateAndPersistIssue({
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

// USER ENDPOINTS
router.get('/users', authenticate, validatePaginationParams, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    const total = await User.countDocuments();
    const users = await User.find().skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
    return successResponse(res, 'Users fetched successfully', users, 200, {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit),
    });
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

// PROJECT ENDPOINTS
router.post('/projects', authenticate, authorize('admin', 'manager'), validateProjectCreation, async (req, res) => {
  try {
    const { title, category, description, members } = req.body;
    const projectId = generateId('PROJ');
    const project = await PersistenceManager.validateAndPersistProject({
      projectId,
      title,
      category: category || '',
      description: description || '',
      owner: req.user.id,
      members: members || [],
    });
    await project.populate('owner').populate('members');
    return successResponse(res, 'Project created successfully', project, 201);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/projects', authenticate, validatePaginationParams, async (req, res) => {
  try {
    const { status, category, search, page = 1, limit = 10 } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) filter.title = { $regex: search, $options: 'i' };
    
    const skip = (page - 1) * limit;
    const total = await Project.countDocuments(filter);
    const data = await Project.find(filter).populate('owner').populate('members').skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
    
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

router.patch('/projects/:projectId', authenticate, authorize('admin', 'manager'), validateProjectUpdate, async (req, res) => {
  try {
    const project = await Project.findOne({ projectId: req.params.projectId });
    if (!project) return errorResponse(res, 'Project not found', 404);
    
    const { title, category, description, members, status } = req.body;
    if (title) project.title = title;
    if (category !== undefined) project.category = category;
    if (description !== undefined) project.description = description;
    if (members) project.members = members;
    if (status) project.status = status;
    
    await project.save();
    await project.populate('owner').populate('members');
    return successResponse(res, 'Project updated successfully', project);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.delete('/projects/:projectId', authenticate, authorize('admin'), async (req, res) => {
  try {
    const project = await Project.findOne({ projectId: req.params.projectId });
    if (!project) return errorResponse(res, 'Project not found', 404);
    await PersistenceManager.deleteProjectCascade(project._id);
    return successResponse(res, 'Project deleted successfully', { projectId: req.params.projectId });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

// ISSUE ENDPOINTS
router.post('/issues', authenticate, validateIssueCreation, async (req, res) => {
  try {
    const { title, description, projectId, priority, severity, assignedTo } = req.body;
    const project = await Project.findOne({ projectId });
    if (!project) return errorResponse(res, 'Project not found', 404);
    
    const issueId = generateId('ISS');
    const issue = await PersistenceManager.validateAndPersistIssue({
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
    return errorResponse(res, err.message, 500);
  }
});

router.get('/issues', authenticate, validatePaginationParams, async (req, res) => {
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

router.patch('/issues/:issueId', authenticate, validateIssueUpdate, async (req, res) => {
  try {
    const issue = await Issue.findOne({ issueId: req.params.issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    
    const { title, description, priority, severity, status } = req.body;
    if (title) issue.title = title;
    if (description !== undefined) issue.description = description;
    if (priority) issue.priority = priority;
    if (severity) issue.severity = severity;
    if (status) issue.status = status;
    
    await issue.save();
    await issue.populate('project').populate('assignedTo').populate('reportedBy');
    return successResponse(res, 'Issue updated successfully', issue);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/issues/:issueId', authenticate, authorize('admin'), async (req, res) => {
  try {
    const issue = await Issue.findOneAndDelete({ issueId: req.params.issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    await Comment.deleteMany({ issue: issue._id });
    return successResponse(res, 'Issue deleted successfully', issue);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

// ISSUE WORKFLOW ENDPOINTS
router.patch('/issues/:issueId/assign', authenticate, authorize('admin', 'manager'), validateAssignIssue, async (req, res) => {
  try {
    const { userId } = req.body;
    const issue = await Issue.findOne({ issueId: req.params.issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    
    const user = await User.findOne({ userId });
    if (!user) return errorResponse(res, 'User not found', 404);
    
    await PersistenceManager.assignIssueToUser(issue._id, user._id);
    await issue.populate('project').populate('assignedTo').populate('reportedBy');
    return successResponse(res, 'Issue assigned successfully', issue);
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

router.patch('/issues/:issueId/status', authenticate, validateChangeIssueStatus, async (req, res) => {
  try {
    const { newStatus } = req.body;
    const issue = await Issue.findOne({ issueId: req.params.issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    
    await issue.changeStatus(newStatus, req.user.id);
    await issue.populate('project').populate('assignedTo').populate('reportedBy');
    
    return successResponse(res, 'Issue status updated successfully', {
      issueId: issue.issueId,
      newStatus: issue.status,
    });
  } catch (err) {
    return errorResponse(res, err.message);
  }
});

// COMMENT ENDPOINTS
router.post('/comments', authenticate, validateCommentCreation, async (req, res) => {
  try {
    const { issueId, message } = req.body;
    const issue = await Issue.findOne({ issueId });
    if (!issue) return errorResponse(res, 'Issue not found', 404);
    
    const commentId = generateId('COM');
    const comment = await PersistenceManager.validateAndPersistComment({
      commentId,
      issue: issue._id,
      user: req.user.id,
      message,
    });
    await comment.populate('issue').populate('user');
    return successResponse(res, 'Comment added successfully', comment, 201);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/comments', authenticate, validatePaginationParams, async (req, res) => {
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

// ANALYTICS ENDPOINTS
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
