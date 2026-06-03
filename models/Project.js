const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  projectId: { type: String, unique: true, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  category: { type: String, default: '' },
  description: { type: String, trim: true, default: '' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['active', 'completed', 'archived'], default: 'active' },
  startDate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Project', projectSchema);
