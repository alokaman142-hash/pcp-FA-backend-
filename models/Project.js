const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  projectId: {
    type: String,
    unique: true,
    required: [true, 'Project ID is required'],
    trim: true,
    index: true,
  },
  title: {
    type: String,
    required: [true, 'Project title is required'],
    trim: true,
    minlength: [2, 'Title must be at least 2 characters'],
    maxlength: [100, 'Title cannot exceed 100 characters'],
  },
  category: {
    type: String,
    trim: true,
    default: '',
    maxlength: [50, 'Category cannot exceed 50 characters'],
  },
  description: {
    type: String,
    trim: true,
    default: '',
    maxlength: [500, 'Description cannot exceed 500 characters'],
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Project owner is required'],
    validate: {
      isAsync: true,
      validator: async function(value) {
        const User = mongoose.model('User');
        const user = await User.findById(value);
        return !!user;
      },
      message: 'Owner user does not exist',
    },
  },
  members: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      validate: {
        isAsync: true,
        validator: async function(value) {
          const User = mongoose.model('User');
          const user = await User.findById(value);
          return !!user;
        },
        message: 'One or more member users do not exist',
      },
    },
  ],
  status: {
    type: String,
    enum: {
      values: ['active', 'completed', 'archived'],
      message: '{VALUE} is not a valid project status',
    },
    default: 'active',
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  endDate: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true, collection: 'projects' });

projectSchema.index({ owner: 1, status: 1 });
projectSchema.index({ title: 'text', description: 'text' });

projectSchema.pre('save', function(next) {
  if (this.members && Array.isArray(this.members)) {
    this.members = [...new Set(this.members.map(id => id.toString()))];
    this.members = this.members.map(id => new mongoose.Types.ObjectId(id));
  }
  this.updatedAt = Date.now();
  next();
});

projectSchema.pre('remove', async function(next) {
  try {
    const Issue = mongoose.model('Issue');
    await Issue.deleteMany({ project: this._id });
    next();
  } catch (error) {
    next(error);
  }
});

projectSchema.methods.addMember = async function(userId) {
  if (!this.members.includes(userId)) {
    this.members.push(userId);
    return await this.save();
  }
  return this;
};

projectSchema.methods.removeMember = async function(userId) {
  this.members = this.members.filter(id => !id.equals(userId));
  return await this.save();
};

module.exports = mongoose.model('Project', projectSchema);
