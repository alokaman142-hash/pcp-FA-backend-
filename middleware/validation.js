const { body, validationResult, param, query } = require('express-validator');
const User = require('../models/User');
const Project = require('../models/Project');
const Issue = require('../models/Issue');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map(err => `${err.param}: ${err.msg}`);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: messages,
    });
  }
  next();
};

const validateUserRegistration = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .trim()
    .toLowerCase()
    .isEmail().withMessage('Valid email is required')
    .custom(async (value) => {
      const user = await User.findOne({ email: value });
      if (user) throw new Error('Email already registered');
    }),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  handleValidationErrors,
];

const validateUserLogin = [
  body('email')
    .trim()
    .toLowerCase()
    .isEmail().withMessage('Valid email is required'),
  body('password')
    .notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

const validateProjectCreation = [
  body('title')
    .trim()
    .notEmpty().withMessage('Project title is required')
    .isLength({ min: 2, max: 100 }).withMessage('Title must be between 2 and 100 characters'),
  body('category')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Category cannot exceed 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('members')
    .optional()
    .isArray().withMessage('Members must be an array')
    .custom(async (value) => {
      if (!Array.isArray(value)) return;
      for (const memberId of value) {
        const user = await User.findById(memberId);
        if (!user) throw new Error(`User with ID ${memberId} does not exist`);
      }
    }),
  handleValidationErrors,
];

const validateProjectUpdate = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Title must be between 2 and 100 characters'),
  body('category')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Category cannot exceed 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('status')
    .optional()
    .isIn(['active', 'completed', 'archived']).withMessage('Invalid project status'),
  body('members')
    .optional()
    .isArray().withMessage('Members must be an array')
    .custom(async (value) => {
      if (!Array.isArray(value)) return;
      for (const memberId of value) {

        const user = await User.findById(memberId);
        if (!user) throw new Error(`User with ID ${memberId} does not exist`);
      }
    }),
  handleValidationErrors,
];

const validateIssueCreation = [
  body('title')
    .trim()
    .notEmpty().withMessage('Issue title is required')
    .isLength({ min: 3, max: 150 }).withMessage('Title must be between 3 and 150 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters'),
  body('projectId')
    .trim()
    .notEmpty().withMessage('Project ID is required')
    .custom(async (value) => {
      const project = await Project.findOne({ projectId: value });
      if (!project) throw new Error('Project does not exist');
    }),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid priority level'),
  body('severity')
    .optional()
    .isIn(['minor', 'major', 'critical']).withMessage('Invalid severity level'),
  body('assignedTo')
    .optional()
    .custom(async (value) => {
      if (!value) return true;
      const user = await User.findById(value);
      if (!user) throw new Error('User does not exist');
    }),
  handleValidationErrors,
];

const validateIssueUpdate = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 150 }).withMessage('Title must be between 3 and 150 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid priority level'),
  body('severity')
    .optional()
    .isIn(['minor', 'major', 'critical']).withMessage('Invalid severity level'),
  body('status')
    .optional()
    .isIn(['open', 'in-progress', 'testing', 'resolved', 'closed']).withMessage('Invalid status'),
  handleValidationErrors,
];

const validateCommentCreation = [
  body('issueId')
    .trim()
    .notEmpty().withMessage('Issue ID is required')
    .custom(async (value) => {
      const issue = await Issue.findOne({ issueId: value });
      if (!issue) throw new Error('Issue does not exist');
    }),
  body('message')
    .trim()
    .notEmpty().withMessage('Comment message is required')
    .isLength({ min: 1, max: 1000 }).withMessage('Message must be between 1 and 1000 characters'),
  handleValidationErrors,
];

const validatePaginationParams = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  handleValidationErrors,
];

const validateAssignIssue = [
  body('userId')
    .trim()
    .notEmpty().withMessage('User ID is required')
    .custom(async (value) => {
      const user = await User.findOne({ userId: value });
      if (!user) throw new Error('User does not exist');
    }),
  handleValidationErrors,
];

const validateChangeIssueStatus = [
  body('newStatus')
    .notEmpty().withMessage('New status is required')
    .isIn(['open', 'in-progress', 'testing', 'resolved', 'closed']).withMessage('Invalid status'),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
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
};
