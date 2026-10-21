import mongoose from 'mongoose';

const employeeSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    defaultHourlyRate: { type: Number, required: true, default: 0 },
    defaultHstApplies: { type: Boolean, required: true, default: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'employees' }
);

employeeSchema.index({ fullName: 1 });

employeeSchema.methods.toApi = function toApi() {
  return {
    id: this._id.toString(),
    full_name: this.fullName,
    default_hourly_rate: this.defaultHourlyRate,
    default_hst_applies: this.defaultHstApplies,
    status: this.status,
    created_at: this.createdAt,
  };
};

export default mongoose.model('Employee', employeeSchema);
