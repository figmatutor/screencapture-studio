const express = require('express');
const router = express.Router();

// 임시 인증 라우트 (개발 중)
router.post('/login', (req, res) => {
  res.json({
    success: true,
    message: '사용자 인증 기능은 개발 예정입니다.',
    token: 'demo_token_' + Date.now()
  });
});

router.post('/register', (req, res) => {
  res.json({
    success: true,
    message: '사용자 등록 기능은 개발 예정입니다.'
  });
});

module.exports = router;