const express = require('express');
const router = express.Router();
const ClipboardCapturer = require('../../services/ClipboardCapturer');
const path = require('path');
const fs = require('fs');

// 클립보드 캡처 인스턴스
let clipboardCapturer = null;

// 클립보드 캡처 인스턴스 초기화
async function getClipboardCapturer() {
    if (!clipboardCapturer) {
        clipboardCapturer = new ClipboardCapturer({
            captureWidth: 1440,
            timeout: 30000,
            waitUntil: 'networkidle0',
            fullPage: true
        });
        await clipboardCapturer.initialize();
    }
    return clipboardCapturer;
}

// 클립보드로 캡처 API
router.post('/capture', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL이 필요합니다.'
            });
        }

        // URL 유효성 검사
        try {
            new URL(url);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: '올바른 URL을 입력해주세요.'
            });
        }

        console.log(`📋 클립보드 캡처 요청: ${url}`);

        const capturer = await getClipboardCapturer();
        const result = await capturer.captureToClipboard(url);

        res.json({
            success: true,
            message: '스크린샷이 클립보드에 복사되었습니다! Figma에서 Ctrl+V (또는 ⌘+V)로 붙여넣을 수 있습니다.',
            data: result
        });

    } catch (error) {
        console.error('클립보드 캡처 오류:', error);
        
        res.status(500).json({
            success: false,
            error: error.message || '캡처 중 오류가 발생했습니다.',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 캡처 및 저장 API
router.post('/capture-and-save', async (req, res) => {
    try {
        const { url, filename } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL이 필요합니다.'
            });
        }

        // URL 유효성 검사
        try {
            new URL(url);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: '올바른 URL을 입력해주세요.'
            });
        }

        console.log(`💾 캡처 및 저장 요청: ${url}`);

        // 저장 경로 설정
        const screenshotsDir = path.join(__dirname, '../../screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        const timestamp = Date.now();
        const domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = filename || `${domain}_${timestamp}.png`;
        const outputPath = path.join(screenshotsDir, fileName);

        const capturer = await getClipboardCapturer();
        
        // 클립보드 복사와 파일 저장을 동시에 수행
        const [clipboardResult, saveResult] = await Promise.all([
            capturer.captureToClipboard(url).catch(err => ({ 
                success: false, 
                error: err.message 
            })),
            capturer.captureAndSave(url, outputPath).catch(err => ({ 
                success: false, 
                error: err.message 
            }))
        ]);

        res.json({
            success: true,
            message: '스크린샷이 클립보드에 복사되고 파일로 저장되었습니다!',
            data: {
                clipboard: clipboardResult,
                file: saveResult,
                downloadUrl: `/api/clipboard/download/${fileName}`
            }
        });

    } catch (error) {
        console.error('캡처 및 저장 오류:', error);
        
        res.status(500).json({
            success: false,
            error: error.message || '캡처 중 오류가 발생했습니다.',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 저장된 이미지 다운로드 API
router.get('/download/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(__dirname, '../../screenshots', filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: '파일을 찾을 수 없습니다.'
            });
        }

        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('다운로드 오류:', err);
                res.status(500).json({
                    success: false,
                    error: '다운로드 중 오류가 발생했습니다.'
                });
            }
        });

    } catch (error) {
        console.error('다운로드 오류:', error);
        res.status(500).json({
            success: false,
            error: '다운로드 중 오류가 발생했습니다.'
        });
    }
});

// 시스템 클립보드 지원 확인 API
router.get('/check-support', (req, res) => {
    const platform = process.platform;
    const supported = ['darwin', 'win32', 'linux'].includes(platform);
    
    res.json({
        success: true,
        platform: platform,
        clipboardSupported: supported,
        message: supported 
            ? '클립보드 기능이 지원됩니다.' 
            : '현재 운영체제에서는 클립보드 기능이 제한될 수 있습니다.'
    });
});

// 캡처 상태 확인 API
router.get('/status', (req, res) => {
    res.json({
        success: true,
        ready: clipboardCapturer !== null,
        platform: process.platform,
        timestamp: new Date().toISOString()
    });
});

// 정리 함수
process.on('SIGINT', async () => {
    if (clipboardCapturer) {
        await clipboardCapturer.close();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (clipboardCapturer) {
        await clipboardCapturer.close();
    }
    process.exit(0);
});

module.exports = router;
