const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const Issue = require('../models/Issue');
const Comment = require('../models/Comment');

class PersistenceManager {
  static async validateAndPersistUser(userData) {
    try {
      const user = new User(userData);
      await user.validate();
      return await user.save();
    } catch (error) {
      throw new Error(`User persistence failed: ${error.message}`);
    }
  }

  static async validateAndPersistProject(projectData) {
    try {
      const project = new Project(projectData);
      await project.validate();
      return await project.save();
    } catch (error) {
      throw new Error(`Project persistence failed: ${error.message}`);
    }
  }

  static async validateAndPersistIssue(issueData) {
    try {
      const issue = new Issue(issueData);
      await issue.validate();
      return await issue.save();
    } catch (error) {
      throw new Error(`Issue persistence failed: ${error.message}`);
    }
  }

  static async validateAndPersistComment(commentData) {
    try {
      const comment = new Comment(commentData);
      await comment.validate();
      return await comment.save();
    } catch (error) {
      throw new Error(`Comment persistence failed: ${error.message}`);
    }
  }

  static async updateProjectMembers(projectId, memberIds) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const project = await Project.findById(projectId).session(session);
      if (!project) throw new Error('Project not found');
      
      for (const memberId of memberIds) {
        const user = await User.findById(memberId).session(session);
        if (!user) throw new Error(`User ${memberId} not found`);
      }
      
      project.members = memberIds;
      await project.save({ session });
      await session.commitTransaction();
      return project;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  static async assignIssueToUser(issueId, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const issue = await Issue.findById(issueId).session(session);
      if (!issue) throw new Error('Issue not found');
      
      const user = await User.findById(userId).session(session);
      if (!user) throw new Error('User not found');
      
      issue.assignedTo = userId;
      await issue.save({ session });
      await session.commitTransaction();
      return issue;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  static async transferIssuesOnUserDelete(oldUserId, newUserId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await Issue.updateMany(
        { assignedTo: oldUserId },
        { assignedTo: newUserId },
        { session }
      );
      await Comment.updateMany(
        { user: oldUserId },
        { user: newUserId },
        { session }
      );
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  static async deleteProjectCascade(projectId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const project = await Project.findById(projectId).session(session);
      if (!project) throw new Error('Project not found');
      
      const issues = await Issue.find({ project: projectId }).session(session);
      
      for (const issue of issues) {
        await Comment.deleteMany({ issue: issue._id }, { session });
      }
      
      await Issue.deleteMany({ project: projectId }, { session });
      await Project.findByIdAndDelete(projectId, { session });
      
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  static async bulkCreateIssues(issuesData) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const createdIssues = [];
      
      for (const issueData of issuesData) {
        const issue = new Issue(issueData);
        await issue.validate();
        const saved = await issue.save({ session });
        createdIssues.push(saved);
      }
      
      await session.commitTransaction();
      return createdIssues;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  static async getProjectWithDetails(projectId) {
    try {
      return await Project.findById(projectId)
        .populate('owner')
        .populate('members')
        .lean();
    } catch (error) {
      throw new Error(`Failed to fetch project details: ${error.message}`);
    }
  }

  static async getIssueWithDetails(issueId) {
    try {
      return await Issue.findById(issueId)
        .populate('project')
        .populate('assignedTo')
        .populate('reportedBy')
        .lean();
    } catch (error) {
      throw new Error(`Failed to fetch issue details: ${error.message}`);
    }
  }

  static async getIssuesForProject(projectId, filters = {}) {
    try {
      let query = Issue.find({ project: projectId });
      
      if (filters.status) query = query.where('status').equals(filters.status);
      if (filters.priority) query = query.where('priority').equals(filters.priority);
      if (filters.severity) query = query.where('severity').equals(filters.severity);
      if (filters.assignedTo) query = query.where('assignedTo').equals(filters.assignedTo);
      if (filters.search) {
        query = query.where('title').regex(new RegExp(filters.search, 'i'))
          .or([{ description: new RegExp(filters.search, 'i') }]);
      }
      
      const page = filters.page || 1;
      const limit = filters.limit || 10;
      const skip = (page - 1) * limit;
      
      query = query.skip(skip).limit(limit).sort({ createdAt: -1 });
      
      const total = await Issue.countDocuments({ project: projectId });
      const data = await query.populate('assignedTo').populate('reportedBy');
      
      return {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        data,
      };
    } catch (error) {
      throw new Error(`Failed to fetch project issues: ${error.message}`);
    }
  }

  static async validateReferentialIntegrity() {
    try {
      const validation = {
        issues: { orphaned: 0, fixed: 0 },
        comments: { orphaned: 0, fixed: 0 },
        projects: { orphaned: 0, fixed: 0 },
      };
      
      const invalidIssues = await Issue.find({
        project: { $nin: await Project.find().distinct('_id') },
      });
      validation.issues.orphaned = invalidIssues.length;
      
      const invalidComments = await Comment.find({
        issue: { $nin: await Issue.find().distinct('_id') },
      });
      validation.comments.orphaned = invalidComments.length;
      
      return validation;
    } catch (error) {
      throw new Error(`Referential integrity check failed: ${error.message}`);
    }
  }

  static async createBackup() {
    try {
      const backup = {
        timestamp: new Date(),
        users: await User.find().lean(),
        projects: await Project.find().lean(),
        issues: await Issue.find().lean(),
        comments: await Comment.find().lean(),
      };
      return backup;
    } catch (error) {
      throw new Error(`Backup creation failed: ${error.message}`);
    }
  }
}

module.exports = PersistenceManager;
