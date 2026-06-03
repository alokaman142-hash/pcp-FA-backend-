const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  commentId: { type: String, unique: true, required: true, trim: true },
  issue: { type: mongoose.Schema.Types.ObjectId, ref: 'Issue', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Comment', commentSchema);
