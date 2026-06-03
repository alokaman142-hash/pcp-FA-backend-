const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  commentId: {
    type: String,
    unique: true,
    required: [true, 'Comment ID is required'],
    trim: true,
    index: true,
  },
  issue: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Issue',
    required: [true, 'Issue reference is required'],
    validate: {
      isAsync: true,
      validator: async function(value) {
        const Issue = mongoose.model('Issue');
        const issue = await Issue.findById(value);
        return !!issue;
      },
      message: 'Referenced issue does not exist',
    },
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Comment author is required'],
    validate: {
      isAsync: true,
      validator: async function(value) {
        const User = mongoose.model('User');
        const user = await User.findById(value);
        return !!user;
      },
      message: 'Comment author user does not exist',
    },
  },
  message: {
    type: String,
    required: [true, 'Comment message is required'],
    trim: true,
    minlength: [1, 'Comment must not be empty'],
    maxlength: [1000, 'Comment cannot exceed 1000 characters'],
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  editedAt: {
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
}, { timestamps: true, collection: 'comments' });

commentSchema.index({ issue: 1, createdAt: -1 });
commentSchema.index({ user: 1 });
commentSchema.index({ message: 'text' });

commentSchema.pre('save', function(next) {
  if (this.isModified('message') && !this.isNew) {
    this.isEdited = true;
    this.editedAt = Date.now();
  }
  this.updatedAt = Date.now();
  next();
});

commentSchema.methods.edit = async function(newMessage) {
  this.message = newMessage;
  this.isEdited = true;
  this.editedAt = new Date();
  return await this.save();
};

module.exports = mongoose.model('Comment', commentSchema);
