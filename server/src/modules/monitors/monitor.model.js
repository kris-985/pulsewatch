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
  nextCheckAt: { type: Date, required: true, default: Date.now },
  slotSequence: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
    validate: { validator: Number.isSafeInteger, message: 'slotSequence must be a non-negative safe integer' },
  },
  nextApplySequence: {
    type: Number,
    required: true,
    min: 1,
    default: 1,
    validate: { validator: Number.isSafeInteger, message: 'nextApplySequence must be a positive safe integer' },
  },
  claimedSlotAt: { type: Date, default: null },
  schedulerEnqueueState: {
    type: String,
    enum: ['idle', 'pending', 'enqueued'],
    required: true,
    default: 'idle',
  },
  schedulerClaimToken: { type: String, default: null },
  schedulerClaimUntil: { type: Date, default: null },
  schedulerRecoveryToken: { type: String, default: null },
  schedulerRecoveryUntil: { type: Date, default: null },
}, { timestamps: true })

monitorSchema.index({ workspaceId: 1, deletedAt: 1, _id: -1 })
monitorSchema.index({ status: 1, deletedAt: 1, schedulerEnqueueState: 1, nextCheckAt: 1, _id: 1 })
monitorSchema.index(
  { schedulerClaimUntil: 1, schedulerRecoveryUntil: 1, _id: 1 },
  { partialFilterExpression: { schedulerEnqueueState: 'pending' } },
)

export const Monitor = mongoose.models.Monitor ?? mongoose.model('Monitor', monitorSchema)
