import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true },
}, { timestamps: true })

userSchema.set('toJSON', {
  transform(_document, result) {
    delete result.passwordHash
    delete result.__v
    return result
  },
})

export const User = mongoose.models.User ?? mongoose.model('User', userSchema)
