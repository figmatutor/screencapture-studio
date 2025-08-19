const mongoose = require('mongoose');

const ScreenshotSchema = new mongoose.Schema({
  url: { type: String, required: true },
  filename: { type: String, required: true },
  title: String,
  capturedAt: { type: Date, default: Date.now },
  viewport: {
    width: Number,
    height: Number,
    deviceType: { type: String, enum: ['desktop', 'tablet', 'mobile'], default: 'desktop' }
  },
  fileSize: Number,
  order: { type: Number, default: 0 }
});

const FlowNodeSchema = new mongoose.Schema({
  id: { type: String, required: true },
  url: { type: String, required: true },
  title: String,
  screenshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Screenshot' },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 }
  },
  connections: [{ type: String }], // 연결된 노드들의 ID 배열
  depth: { type: Number, default: 0 }, // 시작점으로부터의 깊이
  visited: { type: Boolean, default: false }
});

const ProjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  startUrl: { type: String, required: true },
  
  // 크롤링 설정
  crawlSettings: {
    maxPages: { type: Number, default: 20 },
    maxDepth: { type: Number, default: 3 },
    viewport: {
      width: { type: Number, default: 1920 },
      height: { type: Number, default: 1080 },
      deviceType: { type: String, enum: ['desktop', 'tablet', 'mobile'], default: 'desktop' }
    },
    ignorePatterns: [String], // 무시할 URL 패턴들
    loginCredentials: {
      username: String,
      password: String, // 암호화되어 저장
      loginUrl: String,
      usernameSelector: String,
      passwordSelector: String,
      submitSelector: String
    },
    waitForSelectors: [String], // 대기할 셀렉터들
    blockResources: { type: Boolean, default: true }, // 이미지, CSS 등 차단
    customHeaders: { type: Map, of: String }
  },
  
  // 크롤링 결과
  crawlResult: {
    status: { 
      type: String, 
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'], 
      default: 'pending' 
    },
    startedAt: Date,
    completedAt: Date,
    totalPages: { type: Number, default: 0 },
    successfulPages: { type: Number, default: 0 },
    failedPages: { type: Number, default: 0 },
    error: String,
    logs: [String]
  },
  
  // 스크린샷 및 플로우 데이터
  screenshots: [ScreenshotSchema],
  flowNodes: [FlowNodeSchema],
  flowChart: {
    nodes: [mongoose.Schema.Types.Mixed],
    edges: [mongoose.Schema.Types.Mixed],
    layout: { type: String, default: 'hierarchical' }
  },
  
  // 사용자 및 메타데이터
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isPublic: { type: Boolean, default: false },
  tags: [String],
  
  // 내보내기 설정
  exportSettings: {
    format: { type: String, enum: ['pdf', 'png', 'zip'], default: 'pdf' },
    includeFlowChart: { type: Boolean, default: true },
    pageSize: { type: String, default: 'A4' },
    quality: { type: Number, default: 90 }
  }
}, {
  timestamps: true
});

// 인덱스 설정
ProjectSchema.index({ userId: 1 });
ProjectSchema.index({ startUrl: 1 });
ProjectSchema.index({ 'crawlResult.status': 1 });
ProjectSchema.index({ createdAt: -1 });

// 가상 필드
ProjectSchema.virtual('totalScreenshots').get(function() {
  return this.screenshots.length;
});

ProjectSchema.virtual('crawlDuration').get(function() {
  if (this.crawlResult.startedAt && this.crawlResult.completedAt) {
    return this.crawlResult.completedAt - this.crawlResult.startedAt;
  }
  return null;
});

// 메서드
ProjectSchema.methods.addLog = function(message) {
  this.crawlResult.logs.push(`${new Date().toISOString()}: ${message}`);
  return this.save();
};

ProjectSchema.methods.updateStatus = function(status, error = null) {
  this.crawlResult.status = status;
  if (error) {
    this.crawlResult.error = error;
  }
  if (status === 'running' && !this.crawlResult.startedAt) {
    this.crawlResult.startedAt = new Date();
  }
  if (['completed', 'failed', 'cancelled'].includes(status)) {
    this.crawlResult.completedAt = new Date();
  }
  return this.save();
};

module.exports = mongoose.model('Project', ProjectSchema);
