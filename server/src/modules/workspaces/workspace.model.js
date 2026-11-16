import mongoose from 'mongoose'

const workspaceSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  planCode: { type: String, default: 'free', required: true },
  activeMonitorCount: { type: Number, default: 0, min: 0, required: true },
}, { timestamps: true })

export const Workspace = mongoose.models.Workspace ?? mongoose.model('Workspace', workspaceSchema)
