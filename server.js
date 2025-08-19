const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));
app.use('/exports', express.static(path.join(__dirname, 'exports')));

// API 라우트
app.use('/api/auth', require('./server/routes/auth'));
app.use('/api/projects', require('./server/routes/projects'));
app.use('/api/crawl', require('./server/routes/crawl'));
app.use('/api/app', require('./server/routes/app'));
app.use('/api/mobile', require('./server/routes/mobile'));
app.use('/api/export', require('./server/routes/export'));
app.use('/api/clipboard', require('./server/routes/clipboard'));

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '플로우 스크린샷 서비스가 실행 중입니다.',
    timestamp: new Date().toISOString()
  });
});

// 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 핸들링
app.use('*', (req, res) => {
  res.status(404).json({
    error: '요청한 리소스를 찾을 수 없습니다.'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 플로우 스크린샷 서버가 http://localhost:${PORT}에서 실행 중입니다.`);
  console.log(`📱 브라우저에서 http://localhost:${PORT}를 열어 미리보기를 확인하세요.`);
});
