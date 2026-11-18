import mongoose from 'mongoose'

const monitorSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  url: { type: String, required: true, maxlength: 2_048 },
  intervalSeconds: {
    type: Number,
    required: true,
    min: 60,
    default: 60,
    validate: { validator: Number.isInteger, message: 'intervalSeconds must be an integer' },
  },
  status: { type: String, enum: ['active', 'paused'], required: true, default: 'active' },
  currentStatus: { type: String, enum: ['unknown', 'up', 'down'], required: true, default: 'unknown' },
  deletedAt: { type: Date, default: null },
}, { timestamps: true })

monitorSchema.index({ workspaceId: 1, deletedAt: 1, _id: -1 })

export const Monitor = mongoose.models.Monitor ?? mongoose.model('Monitor', monitorSchema)
