const URL = require('url-parse');

class URLValidator {
  static validate(url) {
    const errors = [];
    
    // 기본 URL 형식 검사
    if (!url) {
      errors.push('URL이 필요합니다.');
      return { valid: false, errors };
    }

    // URL 정규화
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    try {
      const parsedUrl = new URL(normalizedUrl);
      
      // 프로토콜 검사
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        errors.push('지원되지 않는 프로토콜입니다. HTTP 또는 HTTPS만 지원됩니다.');
      }

      // 호스트 검사
      if (!parsedUrl.hostname) {
        errors.push('유효하지 않은 호스트명입니다.');
      }

      // localhost 및 사설 IP 주소 검사 (보안상 제한)
      if (this.isPrivateOrLocalhost(parsedUrl.hostname)) {
        errors.push('로컬호스트 및 사설 IP 주소는 보안상 제한됩니다.');
      }

      // 악성 도메인 간단 검사
      if (this.isSuspiciousDomain(parsedUrl.hostname)) {
        errors.push('의심스러운 도메인입니다.');
      }

      return {
        valid: errors.length === 0,
        errors,
        normalizedUrl,
        parsedUrl: {
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          pathname: parsedUrl.pathname,
          search: parsedUrl.search
        }
      };

    } catch (error) {
      errors.push('유효하지 않은 URL 형식입니다.');
      return { valid: false, errors };
    }
  }

  static isPrivateOrLocalhost(hostname) {
    // localhost 체크
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // 사설 IP 대역 체크 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    
    if (match) {
      const [, a, b, c, d] = match.map(Number);
      
      // 10.0.0.0/8
      if (a === 10) return true;
      
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return true;
      
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
    }

    return false;
  }

  static isSuspiciousDomain(hostname) {
    // 기본적인 악성 도메인 패턴 체크
    const suspiciousPatterns = [
      /\.tk$/,  // 무료 최상위 도메인
      /\.ml$/,
      /\.ga$/,
      /\.cf$/,
      /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/, // 순수 IP 주소
    ];

    return suspiciousPatterns.some(pattern => pattern.test(hostname));
  }

  static async isReachable(url, timeout = 10000) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        timeout,
        headers: {
          'User-Agent': 'Flow-Screenshot-Bot/1.0'
        }
      });

      return {
        reachable: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type')
      };

    } catch (error) {
      return {
        reachable: false,
        error: error.message
      };
    }
  }

  static getRobotsTxt(baseUrl) {
    const parsedUrl = new URL(baseUrl);
    return `${parsedUrl.protocol}//${parsedUrl.hostname}/robots.txt`;
  }

  static async checkRobotsPermission(baseUrl, userAgent = '*') {
    try {
      const robotsUrl = this.getRobotsTxt(baseUrl);
      const response = await fetch(robotsUrl, { timeout: 5000 });
      
      if (!response.ok) {
        // robots.txt가 없으면 허용으로 간주
        return { allowed: true, reason: 'No robots.txt found' };
      }

      const robotsText = await response.text();
      const rules = this.parseRobotsTxt(robotsText, userAgent);
      
      return {
        allowed: !rules.disallowed.some(rule => baseUrl.includes(rule)),
        rules
      };

    } catch (error) {
      // 에러 시 허용으로 간주
      return { allowed: true, reason: 'Error checking robots.txt' };
    }
  }

  static parseRobotsTxt(robotsText, userAgent) {
    const lines = robotsText.split('\n');
    let currentUserAgent = '';
    let disallowed = [];
    let allowed = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) continue;

      if (trimmed.toLowerCase().startsWith('user-agent:')) {
        currentUserAgent = trimmed.split(':')[1].trim();
      } else if (currentUserAgent === userAgent || currentUserAgent === '*') {
        if (trimmed.toLowerCase().startsWith('disallow:')) {
          const path = trimmed.split(':')[1].trim();
          if (path) disallowed.push(path);
        } else if (trimmed.toLowerCase().startsWith('allow:')) {
          const path = trimmed.split(':')[1].trim();
          if (path) allowed.push(path);
        }
      }
    }

    return { disallowed, allowed };
  }
}

module.exports = URLValidator;
