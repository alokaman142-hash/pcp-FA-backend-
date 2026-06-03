const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    unique: true,
    required: [true, 'User ID is required'],
    trim: true,
    index: true,
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    validate: [validator.isEmail, 'Please provide a valid email'],
    index: true,
  },
  passwordHash: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false,
  },
  role: {
    type: String,
    enum: {
      values: ['admin', 'manager', 'developer', 'tester'],
      message: '{VALUE} is not a valid role',
    },
    default: 'developer',
  },
  department: {
    type: String,
    trim: true,
    default: '',
    maxlength: [50, 'Department cannot exceed 50 characters'],
  },
  status: {
    type: String,
    enum: {
      values: ['active', 'inactive'],
      message: '{VALUE} is not a valid status',
    },
    default: 'active',
  },
  lastLogin: {
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
}, { timestamps: true, collection: 'users' });

userSchema.index({ email: 1, userId: 1 });
userSchema.index({ role: 1, status: 1 });

userSchema.pre('save', async function(next) {
  if (!this.isModified('passwordHash')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    this.updatedAt = Date.now();
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.passwordHash;
  return user;
};

userSchema.pre('remove', async function(next) {
  try {
    const Project = mongoose.model('Project');
    const Issue = mongoose.model('Issue');
    const Comment = mongoose.model('Comment');
    
    await Project.deleteMany({ owner: this._id });
    await Issue.updateMany(
      { assignedTo: this._id },
      { assignedTo: null }
    );
    await Issue.deleteMany({ reportedBy: this._id });
    await Comment.deleteMany({ user: this._id });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('User', userSchema);
