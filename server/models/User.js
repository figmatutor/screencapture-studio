const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  avatar: String,
  
  // 구독 정보
  subscription: {
    plan: { 
      type: String, 
      enum: ['free', 'pro', 'enterprise'], 
      default: 'free' 
    },
    startDate: Date,
    endDate: Date,
    isActive: { type: Boolean, default: true },
    projectLimit: { type: Number, default: 5 },
    crawlLimit: { type: Number, default: 100 } // 월간 크롤링 한도
  },
  
  // 사용량 통계
  usage: {
    projectsCreated: { type: Number, default: 0 },
    crawlsThisMonth: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now },
    totalScreenshots: { type: Number, default: 0 }
  },
  
  // 설정
  preferences: {
    defaultViewport: {
      width: { type: Number, default: 1920 },
      height: { type: Number, default: 1080 },
      deviceType: { type: String, default: 'desktop' }
    },
    defaultExportFormat: { type: String, default: 'pdf' },
    emailNotifications: { type: Boolean, default: true },
    theme: { type: String, enum: ['light', 'dark'], default: 'light' }
  },
  
  // 계정 상태
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  lastLoginAt: Date,
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

// 인덱스
UserSchema.index({ email: 1 });
UserSchema.index({ 'subscription.plan': 1 });

// 패스워드 해싱 미들웨어
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// 패스워드 검증 메서드
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 월간 사용량 리셋 메서드
UserSchema.methods.resetMonthlyUsage = function() {
  const now = new Date();
  const lastReset = this.usage.lastResetDate;
  
  // 월이 바뀌었는지 확인
  if (lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
    this.usage.crawlsThisMonth = 0;
    this.usage.lastResetDate = now;
    return this.save();
  }
  
  return Promise.resolve(this);
};

// 사용량 증가 메서드
UserSchema.methods.incrementUsage = function(type, amount = 1) {
  switch (type) {
    case 'project':
      this.usage.projectsCreated += amount;
      break;
    case 'crawl':
      this.usage.crawlsThisMonth += amount;
      break;
    case 'screenshot':
      this.usage.totalScreenshots += amount;
      break;
  }
  return this.save();
};

// 구독 한도 확인 메서드
UserSchema.methods.canCreateProject = function() {
  return this.usage.projectsCreated < this.subscription.projectLimit;
};

UserSchema.methods.canCrawl = function() {
  return this.usage.crawlsThisMonth < this.subscription.crawlLimit;
};

// 가상 필드
UserSchema.virtual('fullName').get(function() {
  return this.name;
});

UserSchema.virtual('isSubscriptionActive').get(function() {
  if (this.subscription.plan === 'free') return true;
  return this.subscription.isActive && 
         this.subscription.endDate && 
         this.subscription.endDate > new Date();
});

// JSON 변환 시 민감한 정보 제외
UserSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.emailVerificationToken;
  delete user.passwordResetToken;
  return user;
};

module.exports = mongoose.model('User', UserSchema);
