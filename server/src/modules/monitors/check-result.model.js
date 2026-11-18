import mongoose from 'mongoose'

const checkResultSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  monitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Monitor', required: true },
  slotId: { type: String, required: true, trim: true, minlength: 1, maxlength: 128 },
  slotSequence: {
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isSafeInteger, message: 'slotSequence must be a positive safe integer' },
  },
  scheduledAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'applied', 'skipped'], required: true, default: 'pending' },
  checkOutcome: { type: String, enum: ['success', 'failure'], default: null },
  httpStatusCode: { type: Number, min: 100, max: 599, default: null },
  responseTimeMs: { type: Number, min: 0, default: null },
  errorCode: { type: String, maxlength: 100, default: null },
  errorMessage: { type: String, maxlength: 500, default: null },
  checkedAt: { type: Date, default: null },
  expiresAt: {
    type: Date,
    default: null,
    validate: {
      validator(value) {
        return this.status !== 'pending' || value == null
      },
      message: 'Pending CheckResult documents cannot expire',
    },
  },
}, { timestamps: true })

checkResultSchema.index({ monitorId: 1, slotId: 1 }, { unique: true })
checkResultSchema.index(
  { monitorId: 1, slotSequence: 1 },
  { partialFilterExpression: { status: 'pending' } },
)
checkResultSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } },
)

export const CheckResult = mongoose.models.CheckResult ?? mongoose.model('CheckResult', checkResultSchema)
