const express = require('express');
const router = express.Router();

// 프로젝트 목록 조회
router.get('/', (req, res) => {
  res.json({
    success: true,
    projects: [],
    message: '프로젝트 관리 기능은 개발 예정입니다.'
  });
});

// 프로젝트 생성
router.post('/', (req, res) => {
  res.json({
    success: true,
    message: '프로젝트 생성 기능은 개발 예정입니다.'
  });
});

module.exports = router;
