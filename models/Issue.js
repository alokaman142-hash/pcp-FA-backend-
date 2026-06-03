const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
  issueId: {
    type: String,
    unique: true,
    required: [true, 'Issue ID is required'],
    trim: true,
    index: true,
  },
  title: {
    type: String,
    required: [true, 'Issue title is required'],
    trim: true,
    minlength: [3, 'Title must be at least 3 characters'],
    maxlength: [150, 'Title cannot exceed 150 characters'],
  },
  description: {
    type: String,
    trim: true,
    default: '',
    maxlength: [2000, 'Description cannot exceed 2000 characters'],
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: [true, 'Project is required for an issue'],
    validate: {
      isAsync: true,
      validator: async function(value) {
        const Project = mongoose.model('Project');
        const project = await Project.findById(value);
        return !!project;
      },
      message: 'Referenced project does not exist',
    },
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    validate: {
      isAsync: true,
      validator: async function(value) {
        if (!value) return true;
        const User = mongoose.model('User');
        const user = await User.findById(value);
        return !!user;
      },
      message: 'Assigned user does not exist',
    },
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Reporter is required'],
    validate: {
      isAsync: true,
      validator: async function(value) {
        const User = mongoose.model('User');
        const user = await User.findById(value);
        return !!user;
      },
      message: 'Reporter user does not exist',
    },
  },
  priority: {
    type: String,
    enum: {
      values: ['low', 'medium', 'high', 'critical'],
      message: '{VALUE} is not a valid priority level',
    },
    default: 'medium',
  },
  severity: {
    type: String,
    enum: {
      values: ['minor', 'major', 'critical'],
      message: '{VALUE} is not a valid severity level',
    },
    default: 'major',
  },
  status: {
    type: String,
    enum: {
      values: ['open', 'in-progress', 'testing', 'resolved', 'closed'],
      message: '{VALUE} is not a valid issue status',
    },
    default: 'open',
  },
  statusHistory: [
    {
      status: String,
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
  ],
  tags: [String],
  attachments: [String],
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true, collection: 'issues' });

issueSchema.index({ project: 1, status: 1 });
issueSchema.index({ assignedTo: 1, status: 1 });
issueSchema.index({ reportedBy: 1 });
issueSchema.index({ priority: 1, severity: 1 });
issueSchema.index({ title: 'text', description: 'text' });

issueSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  
  if (this.isModified('status') && this.statusHistory) {
    this.statusHistory.push({
      status: this.status,
      changedAt: new Date(),
    });
  }
  next();
});

issueSchema.pre('remove', async function(next) {
  try {
    const Comment = mongoose.model('Comment');
    await Comment.deleteMany({ issue: this._id });
    next();
  } catch (error) {
    next(error);
  }
});

issueSchema.methods.changeStatus = async function(newStatus, changedBy) {
  if (this.status !== newStatus) {
    this.statusHistory.push({
      status: newStatus,
      changedAt: new Date(),
      changedBy: changedBy,
    });
    this.status = newStatus;
    return await this.save();
  }
  return this;
};

module.exports = mongoose.model('Issue', issueSchema);
