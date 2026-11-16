import mongoose from 'mongoose'

const sessionTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  familyId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  status: { type: String, enum: ['active', 'used', 'revoked'], default: 'active', required: true },
  usedAt: { type: Date, default: null },
  replacedByTokenHash: { type: String, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true })

sessionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
sessionTokenSchema.index({ familyId: 1, status: 1 })

export const SessionToken = mongoose.models.SessionToken ?? mongoose.model('SessionToken', sessionTokenSchema)
