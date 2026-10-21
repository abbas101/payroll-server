import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, default: '' },
    role: { type: String, enum: ['admin', 'user'], default: 'admin' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'users' }
);

userSchema.methods.toApi = function toApi() {
  return {
    id: this._id.toString(),
    username: this.username,
    full_name: this.fullName,
    role: this.role,
  };
};

export default mongoose.model('User', userSchema);
