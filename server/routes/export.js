const express = require('express');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('fontkit');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const sharp = require('sharp');
const router = express.Router();

// 앱 크롤링 결과도 지원
let appCrawlJobs = new Map();
try {
  const appRouter = require('./app');
  appCrawlJobs = appRouter.appCrawlJobs || new Map();
} catch (error) {
  console.log('앱 라우터를 찾을 수 없습니다.');
}

// 모바일 플로우 캡처 결과도 지원
let mobileFlowJobs = new Map();
try {
  const mobileRouter = require('./mobile');
  mobileFlowJobs = mobileRouter.mobileFlowJobs || new Map();
} catch (error) {
  console.log('모바일 라우터를 찾을 수 없습니다.');
}

// 앱 스크린샷 PDF 다운로드
router.get('/app-pdf/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = appCrawlJobs.get(jobId);
    if (!job || job.status !== 'completed') {
      return res.status(404).json({
        success: false,
        error: '완료된 앱 크롤링 작업을 찾을 수 없습니다.'
      });
    }

    const crawlResult = job.result;
    const pdfBytes = await generateAppPDF(crawlResult, jobId);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="app_screenshots_${jobId}.pdf"`);
    res.send(Buffer.from(pdfBytes));
    
  } catch (error) {
    console.error('앱 PDF 생성 오류:', error);
    res.status(500).json({
      success: false,
      error: '앱 PDF 생성 중 오류가 발생했습니다.'
    });
  }
});

// 앱 스크린샷 ZIP 다운로드
router.get('/app-zip/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = appCrawlJobs.get(jobId);
    if (!job || job.status !== 'completed') {
      return res.status(404).json({
        success: false,
        error: '완료된 앱 크롤링 작업을 찾을 수 없습니다.'
      });
    }

    const crawlResult = job.result;
    const zipPath = await generateAppZip(crawlResult, jobId);
    
    res.download(zipPath, `app_screenshots_${jobId}.zip`, (err) => {
      if (err) {
        console.error('앱 ZIP 다운로드 오류:', err);
      }
      // 임시 파일 정리
      fs.unlink(zipPath, () => {});
    });
    
  } catch (error) {
    console.error('앱 ZIP 생성 오류:', error);
    res.status(500).json({
      success: false,
      error: '앱 ZIP 생성 중 오류가 발생했습니다.'
    });
  }
});

// 모바일 플로우 PDF 다운로드
router.get('/mobile-pdf/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = mobileFlowJobs.get(jobId);
    if (!job || job.status !== 'completed') {
      return res.status(404).json({
        success: false,
        error: '완료된 모바일 플로우 캡처 작업을 찾을 수 없습니다.'
      });
    }

    const flowResult = job.result;
    const pdfBytes = await generateMobileFlowPDF(flowResult, jobId);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="mobile_flow_${jobId}.pdf"`);
    res.send(Buffer.from(pdfBytes));
    
  } catch (error) {
    console.error('모바일 플로우 PDF 생성 오류:', error);
    res.status(500).json({
      success: false,
      error: '모바일 플로우 PDF 생성 중 오류가 발생했습니다.'
    });
  }
});

// 모바일 플로우 ZIP 다운로드
router.get('/mobile-zip/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = mobileFlowJobs.get(jobId);
    if (!job || job.status !== 'completed') {
      return res.status(404).json({
        success: false,
        error: '완료된 모바일 플로우 캡처 작업을 찾을 수 없습니다.'
      });
    }

    const flowResult = job.result;
    const zipPath = await generateMobileFlowZip(flowResult, jobId);
    
    res.download(zipPath, `mobile_flow_${jobId}.zip`, (err) => {
      if (err) {
        console.error('모바일 플로우 ZIP 다운로드 오류:', err);
      }
      // 임시 파일 정리
      fs.unlink(zipPath, () => {});
    });
    
  } catch (error) {
    console.error('모바일 플로우 ZIP 생성 오류:', error);
    res.status(500).json({
      success: false,
      error: '모바일 플로우 ZIP 생성 중 오류가 발생했습니다.'
    });
  }
});

// PDF 다운로드
router.get('/pdf/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // 크롤링 결과 조회 (실제로는 DB에서)
    const crawlRouter = require('./crawl');
    const crawlJobs = crawlRouter.crawlJobs || new Map();
    const job = crawlJobs.get(jobId);
    
    if (!job || job.status !== 'completed') {
      return res.status(404).json({
        error: '완료된 크롤링 결과를 찾을 수 없습니다.'
      });
    }

    const pdfPath = await generatePDF(job.result, jobId);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${job.url.replace(/[^a-zA-Z0-9]/g, '_')}_flow_screenshots.pdf"`);
    
    const pdfBuffer = await fs.readFile(pdfPath);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('PDF 생성 오류:', error);
    res.status(500).json({
      error: 'PDF 생성 중 오류가 발생했습니다.'
    });
  }
});

// ZIP 다운로드 (개별 PNG 파일들)
router.get('/zip/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const crawlRouter = require('./crawl');
    const crawlJobs = crawlRouter.crawlJobs || new Map();
    const job = crawlJobs.get(jobId);
    
    if (!job || job.status !== 'completed') {
      return res.status(404).json({
        error: '완료된 크롤링 결과를 찾을 수 없습니다.'
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${job.url.replace(/[^a-zA-Z0-9]/g, '_')}_screenshots.zip"`);

    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.pipe(res);

    // 스크린샷 파일들을 ZIP에 추가
    for (const screenshot of job.result.screenshots) {
      if (await fs.pathExists(screenshot.screenshotPath)) {
        const filename = path.basename(screenshot.screenshotPath);
        archive.file(screenshot.screenshotPath, { name: filename });
      }
    }

    // 플로우차트 텍스트 파일 추가
    const flowChartText = generateFlowChartText(job.result.flowChart);
    archive.append(flowChartText, { name: 'flow_chart.txt' });

    await archive.finalize();

  } catch (error) {
    console.error('ZIP 생성 오류:', error);
    res.status(500).json({
      error: 'ZIP 파일 생성 중 오류가 발생했습니다.'
    });
  }
});

// 개별 스크린샷 다운로드
router.get('/screenshot/:jobId/:screenshotId', async (req, res) => {
  try {
    const { jobId, screenshotId } = req.params;
    
    const crawlRouter = require('./crawl');
    const crawlJobs = crawlRouter.crawlJobs || new Map();
    const job = crawlJobs.get(jobId);
    
    if (!job || job.status !== 'completed') {
      return res.status(404).json({
        error: '완료된 크롤링 결과를 찾을 수 없습니다.'
      });
    }

    const screenshot = job.result.screenshots.find(s => s.id === screenshotId);
    if (!screenshot || !await fs.pathExists(screenshot.screenshotPath)) {
      return res.status(404).json({
        error: '스크린샷 파일을 찾을 수 없습니다.'
      });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(screenshot.screenshotPath)}"`);
    
    const imageBuffer = await fs.readFile(screenshot.screenshotPath);
    res.send(imageBuffer);

  } catch (error) {
    console.error('스크린샷 다운로드 오류:', error);
    res.status(500).json({
      error: '스크린샷 다운로드 중 오류가 발생했습니다.'
    });
  }
});

// 공유 링크 생성
router.post('/share/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { expiresIn = '7d' } = req.body;
    
    const crawlRouter = require('./crawl');
    const crawlJobs = crawlRouter.crawlJobs || new Map();
    const job = crawlJobs.get(jobId);
    
    if (!job || job.status !== 'completed') {
      return res.status(404).json({
        error: '완료된 크롤링 결과를 찾을 수 없습니다.'
      });
    }

    // 공유 토큰 생성
    const shareToken = generateShareToken();
    const expiryDate = new Date();
    
    // 만료 시간 계산
    const expiry = parseExpiry(expiresIn);
    expiryDate.setTime(expiryDate.getTime() + expiry);

    // 공유 정보 저장 (실제로는 DB에 저장)
    const shareInfo = {
      jobId,
      token: shareToken,
      expiresAt: expiryDate,
      createdAt: new Date(),
      accessCount: 0
    };

    // 임시로 메모리에 저장
    global.shareLinks = global.shareLinks || new Map();
    global.shareLinks.set(shareToken, shareInfo);

    res.json({
      success: true,
      shareUrl: `${req.protocol}://${req.get('host')}/api/export/shared/${shareToken}`,
      expiresAt: expiryDate,
      token: shareToken
    });

  } catch (error) {
    console.error('공유 링크 생성 오류:', error);
    res.status(500).json({
      error: '공유 링크 생성 중 오류가 발생했습니다.'
    });
  }
});

// 공유 링크 접근
router.get('/shared/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const shareLinks = global.shareLinks || new Map();
    const shareInfo = shareLinks.get(token);
    
    if (!shareInfo) {
      return res.status(404).json({
        error: '유효하지 않은 공유 링크입니다.'
      });
    }

    if (new Date() > shareInfo.expiresAt) {
      shareLinks.delete(token);
      return res.status(410).json({
        error: '만료된 공유 링크입니다.'
      });
    }

    // 접근 횟수 증가
    shareInfo.accessCount++;

    const crawlJobs = require('./crawl').crawlJobs || new Map();
    const job = crawlJobs.get?.(shareInfo.jobId);
    
    if (!job) {
      return res.status(404).json({
        error: '크롤링 결과를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      result: job.result,
      sharedAt: shareInfo.createdAt,
      accessCount: shareInfo.accessCount,
      downloadLinks: {
        pdf: `/api/export/shared/${token}/pdf`,
        zip: `/api/export/shared/${token}/zip`
      }
    });

  } catch (error) {
    console.error('공유 링크 접근 오류:', error);
    res.status(500).json({
      error: '공유 링크 접근 중 오류가 발생했습니다.'
    });
  }
});

// PDF 생성 함수
async function generatePDF(crawlResult, jobId) {
  const pdfDoc = await PDFDocument.create();
  
  // fontkit 등록
  pdfDoc.registerFontkit(fontkit);
  
  // 메타데이터 설정
  pdfDoc.setTitle('Flow Screenshots');
  pdfDoc.setAuthor('Flow Screenshot Service');
  pdfDoc.setCreationDate(new Date());

  // 기본 폰트 사용 (안정성 우선)
  let koreanFont;
  try {
    // PDF-lib의 기본 폰트 사용 (Helvetica)
    koreanFont = await pdfDoc.embedFont('Helvetica');
  } catch (error) {
    console.warn('폰트 로드 실패, 기본 폰트 사용:', error.message);
    koreanFont = null;
  }

  // 커버 페이지 추가
  const coverPage = pdfDoc.addPage([595, 842]); // A4 크기
  const { width, height } = coverPage.getSize();
  
  // 영어로 텍스트 생성 (폰트 호환성 문제 방지)
  const drawTextSafely = (page, text, x, y, size = 12, font = koreanFont) => {
    try {
      page.drawText(text, {
        x,
        y,
        size,
        color: rgb(0, 0, 0),
        font: font || undefined // font가 null이면 기본 폰트 사용
      });
    } catch (error) {
      console.warn('텍스트 그리기 실패, 기본 폰트로 재시도:', error.message);
      page.drawText(text, { x, y, size, color: rgb(0, 0, 0) });
    }
  };

  drawTextSafely(coverPage, 'Flow Screenshot Report', 50, height - 100, 24);
  drawTextSafely(coverPage, `Total ${crawlResult.totalPages} pages captured`, 50, height - 150, 16);

  drawTextSafely(coverPage, `Generated: ${new Date().toLocaleDateString('en-US')}`, 50, height - 180, 12);

  // 플로우차트 텍스트 페이지
  if (crawlResult.flowChart) {
    const flowPage = pdfDoc.addPage([595, 842]);
    const flowText = generateFlowChartText(crawlResult.flowChart);
    
    drawTextSafely(flowPage, 'Page Flow Chart', 50, height - 100, 18);

    const lines = flowText.split('\n').slice(0, 25); // 25줄까지만 표시
    lines.forEach((line, index) => {
      if (50 + (index * 20) < height - 150) {
        // ASCII가 아닌 문자는 URL 인코딩하거나 생략
        const safeText = line.replace(/[^\x00-\x7F]/g, '');
        if (safeText.trim().length > 0) {
          drawTextSafely(flowPage, safeText, 50, height - 150 - (index * 20), 10);
        }
      }
    });
  }

  // 스크린샷 페이지들 추가
  for (const screenshot of crawlResult.screenshots) {
    if (await fs.pathExists(screenshot.screenshotPath)) {
      try {
        // 이미지 리사이즈 (PDF 페이지에 맞게)
        const resizedImageBuffer = await sharp(screenshot.screenshotPath)
          .resize(500, null, { 
            withoutEnlargement: true,
            fit: 'inside'
          })
          .png()
          .toBuffer();

        const pngImage = await pdfDoc.embedPng(resizedImageBuffer);
        const imagePage = pdfDoc.addPage([595, 842]);
        
        // 페이지 제목 (ASCII만 사용)
        const safeTitle = (screenshot.title || screenshot.url).replace(/[^\x00-\x7F]/g, '').substring(0, 60);
        if (safeTitle.trim().length > 0) {
          drawTextSafely(imagePage, safeTitle, 50, height - 50, 12);
        }

        // URL (ASCII만 사용)
        const safeUrl = screenshot.url.replace(/[^\x00-\x7F]/g, '');
        if (safeUrl.length > 0) {
          drawTextSafely(imagePage, safeUrl, 50, height - 70, 8);
        }

        // 이미지 삽입
        const { width: imgWidth, height: imgHeight } = pngImage.scale(0.8);
        imagePage.drawImage(pngImage, {
          x: (width - imgWidth) / 2,
          y: height - 100 - imgHeight,
          width: imgWidth,
          height: imgHeight
        });

      } catch (imageError) {
        console.warn(`이미지 처리 실패: ${screenshot.screenshotPath}`, imageError);
      }
    }
  }

  // PDF 저장
  const pdfBytes = await pdfDoc.save();
  const pdfPath = path.join(__dirname, '../exports', `${jobId}_flow_screenshots.pdf`);
  
  await fs.ensureDir(path.dirname(pdfPath));
  await fs.writeFile(pdfPath, pdfBytes);
  
  return pdfPath;
}

// 플로우차트 텍스트 생성
function generateFlowChartText(flowChart) {
  if (!flowChart || !flowChart.nodes) return '';
  
  let text = '=== 웹사이트 플로우차트 ===\n\n';
  
  text += '📄 페이지 목록:\n';
  flowChart.nodes.forEach((node, index) => {
    text += `${index + 1}. ${node.label}\n`;
    text += `   URL: ${node.url}\n`;
    text += `   레벨: ${node.level}\n\n`;
  });

  if (flowChart.edges && flowChart.edges.length > 0) {
    text += '\n🔗 페이지 연결:\n';
    flowChart.edges.forEach(edge => {
      const fromNode = flowChart.nodes.find(n => n.id === edge.from);
      const toNode = flowChart.nodes.find(n => n.id === edge.to);
      
      if (fromNode && toNode) {
        text += `${fromNode.label} → ${toNode.label}\n`;
      }
    });
  }

  return text;
}

// 공유 토큰 생성
function generateShareToken() {
  return Math.random().toString(36).substr(2, 15) + Date.now().toString(36);
}

// 만료 시간 파싱
function parseExpiry(expiresIn) {
  const units = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };
  
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (match) {
    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }
  
  return 7 * 24 * 60 * 60 * 1000; // 기본 7일
}

// 앱 PDF 생성 함수
async function generateAppPDF(crawlResult, jobId) {
  const pdfDoc = await PDFDocument.create();
  
  // fontkit 등록
  pdfDoc.registerFontkit(fontkit);
  
  // 메타데이터 설정
  pdfDoc.setTitle(`App Screenshots - ${crawlResult.appInfo.title || 'Unknown App'}`);
  pdfDoc.setAuthor('Flow Screenshot Service');
  pdfDoc.setCreationDate(new Date());

  // 기본 폰트 사용
  let font;
  try {
    font = await pdfDoc.embedFont('Helvetica');
  } catch (error) {
    console.warn('폰트 로드 실패, 기본 폰트 사용:', error.message);
    font = null;
  }

  // 안전한 텍스트 그리기 함수
  const drawTextSafely = (page, text, x, y, size = 12, fontToUse = font) => {
    try {
      page.drawText(text, {
        x, y, size,
        color: rgb(0, 0, 0),
        font: fontToUse || undefined
      });
    } catch (error) {
      console.warn('텍스트 그리기 실패, 기본 폰트로 재시도:', error.message);
      page.drawText(text, { x, y, size, color: rgb(0, 0, 0) });
    }
  };

  // 커버 페이지 추가
  const coverPage = pdfDoc.addPage([595, 842]); // A4 크기
  const { width, height } = coverPage.getSize();
  
  drawTextSafely(coverPage, 'App Screenshots Report', 50, height - 100, 24);
  drawTextSafely(coverPage, `App: ${crawlResult.appInfo.title || 'Unknown'}`, 50, height - 150, 16);
  drawTextSafely(coverPage, `Developer: ${crawlResult.appInfo.developer || 'Unknown'}`, 50, height - 180, 16);
  drawTextSafely(coverPage, `Total Screenshots: ${crawlResult.screenshots.length}`, 50, height - 210, 16);
  drawTextSafely(coverPage, `Generated: ${new Date().toLocaleDateString('en-US')}`, 50, height - 240, 12);

  // 앱 정보 페이지
  if (crawlResult.appInfo && Object.keys(crawlResult.appInfo).length > 0) {
    const infoPage = pdfDoc.addPage([595, 842]);
    
    drawTextSafely(infoPage, 'App Information', 50, height - 100, 18);
    
    let yPos = height - 150;
    const lineHeight = 25;
    
    Object.entries(crawlResult.appInfo).forEach(([key, value]) => {
      if (value && yPos > 50) {
        const safeKey = key.replace(/[^\x00-\x7F]/g, '');
        const safeValue = String(value).replace(/[^\x00-\x7F]/g, '').substring(0, 80);
        
        if (safeKey && safeValue) {
          drawTextSafely(infoPage, `${safeKey}: ${safeValue}`, 50, yPos, 12);
          yPos -= lineHeight;
        }
      }
    });
  }

  // 스크린샷 페이지들 추가
  for (const screenshot of crawlResult.screenshots) {
    const screenshotPath = path.join(__dirname, '../../screenshots', screenshot.filename);
    
    if (await fs.pathExists(screenshotPath)) {
      try {
        // 이미지 크기 조정
        const resizedImageBuffer = await sharp(screenshotPath)
          .resize(500, 700, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();

        const pngImage = await pdfDoc.embedPng(resizedImageBuffer);
        const imagePage = pdfDoc.addPage([595, 842]);
        
        // 스크린샷 제목
        const safeTitle = `Screenshot ${screenshot.index}`.replace(/[^\x00-\x7F]/g, '');
        if (safeTitle.trim().length > 0) {
          drawTextSafely(imagePage, safeTitle, 50, height - 50, 12);
        }

        // 이미지 삽입
        const { width: imgWidth, height: imgHeight } = pngImage.scale(0.8);
        imagePage.drawImage(pngImage, {
          x: (width - imgWidth) / 2,
          y: height - imgHeight - 80,
          width: imgWidth,
          height: imgHeight
        });
        
        // 스크린샷 정보
        if (screenshot.width && screenshot.height) {
          drawTextSafely(imagePage, `Size: ${screenshot.width}x${screenshot.height}`, 50, height - imgHeight - 100, 10);
        }
        
      } catch (error) {
        console.warn(`스크린샷 처리 실패: ${screenshot.filename}`, error.message);
      }
    }
  }

  return await pdfDoc.save();
}

// 앱 ZIP 생성 함수
async function generateAppZip(crawlResult, jobId) {
  const zipPath = path.join(__dirname, '../../exports', `app_screenshots_${jobId}.zip`);
  
  // 디렉토리 생성
  await fs.ensureDir(path.dirname(zipPath));
  
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`📦 앱 ZIP 생성 완료: ${archive.pointer()} bytes`);
      resolve(zipPath);
    });
    
    archive.on('error', (err) => {
      console.error('ZIP 생성 오류:', err);
      reject(err);
    });
    
    archive.pipe(output);
    
    // 앱 정보 JSON 추가
    if (crawlResult.appInfo) {
      archive.append(JSON.stringify(crawlResult.appInfo, null, 2), { 
        name: 'app_info.json' 
      });
    }
    
    // 스크린샷 메타데이터 추가
    archive.append(JSON.stringify(crawlResult.screenshots, null, 2), { 
      name: 'screenshots_info.json' 
    });
    
    // 스크린샷 파일들 추가
    crawlResult.screenshots.forEach((screenshot, index) => {
      const screenshotPath = path.join(__dirname, '../../screenshots', screenshot.filename);
      
      if (fs.existsSync(screenshotPath)) {
        archive.file(screenshotPath, { 
          name: `screenshots/${screenshot.filename}` 
        });
      }
    });
    
    archive.finalize();
  });
}

// 모바일 플로우 PDF 생성 함수
async function generateMobileFlowPDF(flowResult, jobId) {
  const pdfDoc = await PDFDocument.create();
  
  // fontkit 등록
  pdfDoc.registerFontkit(fontkit);
  
  // 메타데이터 설정
  pdfDoc.setTitle(`Mobile Flow Report - ${flowResult.scenario || 'Unknown Scenario'}`);
  pdfDoc.setAuthor('Flow Screenshot Service');
  pdfDoc.setCreationDate(new Date());

  // 기본 폰트 사용
  let font;
  try {
    font = await pdfDoc.embedFont('Helvetica');
  } catch (error) {
    console.warn('폰트 로드 실패, 기본 폰트 사용:', error.message);
    font = null;
  }

  // 안전한 텍스트 그리기 함수
  const drawTextSafely = (page, text, x, y, size = 12, fontToUse = font) => {
    try {
      page.drawText(text, {
        x, y, size,
        color: rgb(0, 0, 0),
        font: fontToUse || undefined
      });
    } catch (error) {
      console.warn('텍스트 그리기 실패, 기본 폰트로 재시도:', error.message);
      page.drawText(text, { x, y, size, color: rgb(0, 0, 0) });
    }
  };

  // 커버 페이지 추가
  const coverPage = pdfDoc.addPage([595, 842]); // A4 크기
  const { width, height } = coverPage.getSize();
  
  drawTextSafely(coverPage, 'Mobile App Flow Report', 50, height - 100, 24);
  drawTextSafely(coverPage, `Scenario: ${flowResult.scenario || 'Custom Scenario'}`, 50, height - 150, 16);
  drawTextSafely(coverPage, `Platform: ${flowResult.platform?.toUpperCase() || 'Unknown'}`, 50, height - 180, 16);
  drawTextSafely(coverPage, `Device: ${flowResult.deviceId || 'Unknown'}`, 50, height - 210, 16);
  drawTextSafely(coverPage, `Total Steps: ${flowResult.totalSteps || flowResult.screenshots?.length || 0}`, 50, height - 240, 16);
  drawTextSafely(coverPage, `Generated: ${new Date().toLocaleDateString('en-US')}`, 50, height - 270, 12);

  // 플로우 단계 개요 페이지
  if (flowResult.screenshots && flowResult.screenshots.length > 0) {
    const summaryPage = pdfDoc.addPage([595, 842]);
    
    drawTextSafely(summaryPage, 'Flow Steps Summary', 50, height - 100, 18);
    
    let yPos = height - 150;
    const lineHeight = 25;
    
    flowResult.screenshots.forEach((screenshot, index) => {
      if (yPos > 50) {
        const stepInfo = `Step ${index + 1}: ${screenshot.stepName || 'Unknown Step'}`;
        const safeStepInfo = stepInfo.replace(/[^\x00-\x7F]/g, '').substring(0, 70);
        
        if (safeStepInfo.trim().length > 0) {
          drawTextSafely(summaryPage, safeStepInfo, 50, yPos, 12);
          yPos -= lineHeight;
        }
      }
    });
  }

  // 스크린샷 페이지들 추가
  for (const [index, screenshot] of flowResult.screenshots.entries()) {
    const screenshotPath = path.join(__dirname, '../../screenshots', screenshot.filename);
    
    if (await fs.pathExists(screenshotPath)) {
      try {
        // 모바일 스크린샷 크기 조정 (세로 비율 유지)
        const resizedImageBuffer = await sharp(screenshotPath)
          .resize(300, 600, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer();

        const pngImage = await pdfDoc.embedPng(resizedImageBuffer);
        const imagePage = pdfDoc.addPage([595, 842]);
        
        // 스크린샷 제목
        const safeTitle = `Step ${index + 1}: ${screenshot.stepName || 'Unknown'}`.replace(/[^\x00-\x7F]/g, '');
        if (safeTitle.trim().length > 0) {
          drawTextSafely(imagePage, safeTitle, 50, height - 50, 14);
        }

        // 이미지 삽입 (중앙 정렬, 모바일 비율)
        const { width: imgWidth, height: imgHeight } = pngImage.scale(1);
        const imageX = (width - imgWidth) / 2;
        const imageY = height - imgHeight - 100;
        
        imagePage.drawImage(pngImage, {
          x: imageX,
          y: imageY,
          width: imgWidth,
          height: imgHeight
        });
        
        // 추가 정보
        drawTextSafely(imagePage, `Platform: ${flowResult.platform || 'Unknown'}`, 50, imageY - 30, 10);
        drawTextSafely(imagePage, `Timestamp: ${new Date(screenshot.timestamp).toLocaleString()}`, 50, imageY - 50, 10);
        
      } catch (error) {
        console.warn(`스크린샷 처리 실패: ${screenshot.filename}`, error.message);
      }
    }
  }

  return await pdfDoc.save();
}

// 모바일 플로우 ZIP 생성 함수
async function generateMobileFlowZip(flowResult, jobId) {
  const zipPath = path.join(__dirname, '../../exports', `mobile_flow_${jobId}.zip`);
  
  // 디렉토리 생성
  await fs.ensureDir(path.dirname(zipPath));
  
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`📦 모바일 플로우 ZIP 생성 완료: ${archive.pointer()} bytes`);
      resolve(zipPath);
    });
    
    archive.on('error', (err) => {
      console.error('ZIP 생성 오류:', err);
      reject(err);
    });
    
    archive.pipe(output);
    
    // 플로우 정보 JSON 추가
    const flowInfo = {
      scenario: flowResult.scenario,
      platform: flowResult.platform,
      deviceId: flowResult.deviceId,
      totalSteps: flowResult.totalSteps,
      captureDate: new Date().toISOString()
    };
    
    archive.append(JSON.stringify(flowInfo, null, 2), { 
      name: 'flow_info.json' 
    });
    
    // 스크린샷 메타데이터 추가
    archive.append(JSON.stringify(flowResult.screenshots, null, 2), { 
      name: 'screenshots_metadata.json' 
    });
    
    // 스크린샷 파일들 추가
    flowResult.screenshots.forEach((screenshot, index) => {
      const screenshotPath = path.join(__dirname, '../../screenshots', screenshot.filename);
      
      if (fs.existsSync(screenshotPath)) {
        const stepNumber = String(index + 1).padStart(2, '0');
        const fileName = `${stepNumber}_${screenshot.stepName}_${screenshot.filename}`;
        
        archive.file(screenshotPath, { 
          name: `flow_screenshots/${fileName}` 
        });
      }
    });
    
    archive.finalize();
  });
}

module.exports = router;
