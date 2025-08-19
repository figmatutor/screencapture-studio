const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT 토큰 인증 미들웨어
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        error: '액세스 토큰이 필요합니다.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 사용자 존재 확인
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        error: '유효하지 않은 토큰입니다.'
      });
    }

    req.userId = decoded.userId;
    req.user = user;
    next();

  } catch (error) {
    console.error('인증 오류:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: '유효하지 않은 토큰입니다.'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: '만료된 토큰입니다. 다시 로그인해주세요.'
      });
    }

    res.status(500).json({
      error: '인증 처리 중 오류가 발생했습니다.'
    });
  }
};

// 구독 플랜 확인 미들웨어
const checkSubscription = (requiredPlan = 'free') => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user.isSubscriptionActive) {
        return res.status(403).json({
          error: '구독이 만료되었습니다. 구독을 갱신해주세요.'
        });
      }

      const planLevels = { free: 0, pro: 1, enterprise: 2 };
      const userLevel = planLevels[user.subscription.plan];
      const requiredLevel = planLevels[requiredPlan];

      if (userLevel < requiredLevel) {
        return res.status(403).json({
          error: `이 기능은 ${requiredPlan} 플랜 이상에서 사용할 수 있습니다.`,
          requiredPlan,
          currentPlan: user.subscription.plan
        });
      }

      next();
    } catch (error) {
      console.error('구독 확인 오류:', error);
      res.status(500).json({
        error: '구독 상태 확인 중 오류가 발생했습니다.'
      });
    }
  };
};

// 사용량 한도 확인 미들웨어
const checkUsageLimit = (type) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      // 월간 사용량 리셋 확인
      await user.resetMonthlyUsage();

      let canProceed = false;
      let errorMessage = '';

      switch (type) {
        case 'project':
          canProceed = user.canCreateProject();
          errorMessage = `프로젝트 생성 한도(${user.subscription.projectLimit}개)에 도달했습니다.`;
          break;
        case 'crawl':
          canProceed = user.canCrawl();
          errorMessage = `월간 크롤링 한도(${user.subscription.crawlLimit}회)에 도달했습니다.`;
          break;
        default:
          canProceed = true;
      }

      if (!canProceed) {
        return res.status(403).json({
          error: errorMessage,
          usage: user.usage,
          subscription: user.subscription
        });
      }

      next();
    } catch (error) {
      console.error('사용량 확인 오류:', error);
      res.status(500).json({
        error: '사용량 확인 중 오류가 발생했습니다.'
      });
    }
  };
};

// 관리자 권한 확인 미들웨어
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: '관리자 권한이 필요합니다.'
    });
  }
  next();
};

module.exports = {
  auth,
  checkSubscription,
  checkUsageLimit,
  requireAdmin
};
