const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 미들웨어 설정
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://flowscreenshot.com'] 
    : ['http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 정적 파일 제공
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/screenshots', express.static(path.join(__dirname, '../screenshots')));

// API 라우트
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/crawl', require('./routes/crawl'));
app.use('/api/app', require('./routes/app')); // 앱스토어 크롤링 라우트 추가
app.use('/api/export', require('./routes/export'));

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 프로덕션에서 React 앱 제공
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: '서버 내부 오류가 발생했습니다.',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 핸들링
app.use('*', (req, res) => {
  res.status(404).json({
    error: '요청한 리소스를 찾을 수 없습니다.'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 플로우 스크린샷 서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`📱 개발 환경: ${process.env.NODE_ENV}`);
});
