require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Config
const PORT = process.env.PORT || 3000;
const MAX_COMBINATIONS = parseInt(process.env.MAX_COMBINATIONS, 10) || 1000;

// Ensure exports directory exists
const exportsDir = path.join(__dirname, 'exports');
if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
}

// ─── Health Check ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', maxCombinations: MAX_COMBINATIONS });
});

// ─── Browser Launch Options ───────────────────────────────────────────────
const puppeteerLaunchOptions = {
    headless: 'new',
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
    ]
};

// ─── Test a single credential pair (reuses browser) ─────────────────────────
async function testSingleLogin(browser, loginUrl, userId, password, selectors) {
    const page = await browser.newPage();
    const startTime = Date.now();

    try {
        await page.setDefaultTimeout(10000);
        await page.setViewport({ width: 1280, height: 800 });

        await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        // Parse comma-separated selectors
        const usernameSelectors = selectors.username.split(',').map(s => s.trim());
        const passwordSelectors = selectors.password.split(',').map(s => s.trim());
        const submitSelectors = selectors.submit.split(',').map(s => s.trim());

        // ── Fill username ──────────────────────────────────────────────────
        let usernameFilled = false;
        for (const sel of usernameSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 2000 });
                await page.type(sel, userId);
                usernameFilled = true;
                break;
            } catch (e) { continue; }
        }
        if (!usernameFilled) {
            try {
                await page.type('input[type="text"], input[type="email"], input:not([type])', userId);
                usernameFilled = true;
            } catch (e) {
                throw new Error('Could not find username input field');
            }
        }

        // ── Fill password ──────────────────────────────────────────────────
        let passwordFilled = false;
        for (const sel of passwordSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 2000 });
                await page.type(sel, password);
                passwordFilled = true;
                break;
            } catch (e) { continue; }
        }
        if (!passwordFilled) {
            try {
                await page.type('input[type="password"]', password);
                passwordFilled = true;
            } catch (e) {
                throw new Error('Could not find password input field');
            }
        }

        // ── Submit form ────────────────────────────────────────────────────
        let clicked = false;
        for (const sel of submitSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 2000 });
                await page.click(sel);
                clicked = true;
                break;
            } catch (e) { continue; }
        }
        if (!clicked) {
            await page.keyboard.press('Enter');
        }

        // ── Wait for navigation / feedback ─────────────────────────────────
        await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }),
            page.waitForSelector('.error, .alert-danger, .success, .alert-success', { timeout: 5000 }),
            new Promise(resolve => setTimeout(resolve, 3000))
        ]).catch(() => {});

        const pageContent = await page.content();
        const currentUrl = page.url();
        const title = await page.title();
        const contentLower = pageContent.toLowerCase();
        const urlLower = currentUrl.toLowerCase();

        // ── Detect success / failure ───────────────────────────────────────
        const successIndicators = [
            'dashboard', 'welcome', 'home', 'account', 'profile',
            'logged in', 'success', 'redirect', 'admin', 'portal',
            'overview', 'main', 'index', 'my account'
        ];
        const failureIndicators = [
            'incorrect', 'invalid', 'error', 'failed', 'wrong',
            'try again', 'not found', 'expired', 'locked',
            'unauthorized', 'forbidden', 'bad request'
        ];

        let success = false;
        let reason = '';

        // URL checks
        for (const indicator of successIndicators) {
            if (urlLower.includes(indicator)) {
                success = true;
                reason = `URL contains "${indicator}"`;
                break;
            }
        }

        // Content checks (success)
        if (!success) {
            for (const indicator of successIndicators) {
                if (contentLower.includes(indicator)) {
                    success = true;
                    reason = `Page contains "${indicator}"`;
                    break;
                }
            }
        }

        // Content checks (failure)
        if (!success) {
            for (const indicator of failureIndicators) {
                if (contentLower.includes(indicator)) {
                    success = false;
                    reason = `Page contains "${indicator}"`;
                    break;
                }
            }
        }

        // Error DOM elements
        if (!success) {
            const errorElements = await page.$$eval(
                '.error, .alert-danger, .error-message, .invalid, .alert-error, .form-error, .notification-error',
                els => els.length
            );
            if (errorElements > 0) {
                success = false;
                reason = 'Error element found on page';
            }
        }

        const duration = Date.now() - startTime;

        return {
            success,
            userId,
            password,
            title,
            url: currentUrl,
            reason: reason || (success ? 'Login successful' : 'Login failed — no specific reason detected'),
            durationMs: duration,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        return {
            success: false,
            userId,
            password,
            error: error.message,
            reason: `Error: ${error.message}`,
            durationMs: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };
    } finally {
        try { await page.close(); } catch (e) {}
    }
}

// ─── Test all combinations (single browser instance) ────────────────────────
async function testAllCombinations(loginUrl, userIds, passwords, selectors) {
    let browser;
    try {
        browser = await puppeteer.launch(puppeteerLaunchOptions);
    } catch (launchErr) {
        console.error('Failed to launch browser:', launchErr.message);
        throw new Error('Browser launch failed. If deploying to cloud, ensure Chromium dependencies are installed (see README).');
    }

    const results = [];
    const total = userIds.length * passwords.length;
    let completed = 0;

    console.log(`🧪 Matrix test: ${userIds.length} IDs × ${passwords.length} passwords = ${total} combinations`);
    console.log(`📝 Login URL: ${loginUrl}`);

    try {
        for (const userId of userIds) {
            for (const password of passwords) {
                const result = await testSingleLogin(browser, loginUrl, userId, password, selectors);
                results.push(result);
                completed++;

                if (completed % 5 === 0 || completed === total) {
                    console.log(`📊 Progress: ${completed}/${total} (${Math.round(completed / total * 100)}%)`);
                }

                // Polite delay between attempts
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
    } finally {
        try { await browser.close(); } catch (e) {}
    }

    const successful = results.filter(r => r.success === true);
    const failed = results.filter(r => r.success === false);

    console.log(`✅ Complete! ${successful.length} successful, ${failed.length} failed`);

    return {
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        results,
        successfulLogins: successful,
        timestamp: new Date().toISOString()
    };
}

// ─── API: Test credentials ──────────────────────────────────────────────────
app.post('/api/test', async (req, res) => {
    const { loginUrl, userIds, passwords, selectors } = req.body;

    if (!loginUrl || !userIds || !passwords || userIds.length === 0 || passwords.length === 0) {
        return res.status(400).json({ error: 'Missing required fields: loginUrl, userIds, passwords' });
    }

    // Validate URL
    try {
        const parsed = new URL(loginUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
        }
    } catch {
        return res.status(400).json({ error: 'Invalid login URL. Must be a valid http:// or https:// URL.' });
    }

    const total = userIds.length * passwords.length;
    if (total > MAX_COMBINATIONS) {
        return res.status(400).json({
            error: `Too many combinations (${total}). Maximum allowed is ${MAX_COMBINATIONS}. Reduce your lists or increase MAX_COMBINATIONS env var.`
        });
    }

    const defaultSelectors = {
        username: selectors?.username || 'input[name="username"], input[name="user"], input[name="email"], #username, #user, #email, input[type="text"]',
        password: selectors?.password || 'input[name="password"], input[name="pass"], #password, #pass, input[type="password"]',
        submit: selectors?.submit || 'button[type="submit"], input[type="submit"], #login, #submit, .login-button, .submit-button'
    };

    console.log(`🚀 Starting test for ${loginUrl}`);
    console.log(`📝 ${userIds.length} IDs × ${passwords.length} passwords = ${total} combinations`);

    try {
        const results = await testAllCombinations(loginUrl, userIds, passwords, defaultSelectors);
        res.json(results);
    } catch (error) {
        console.error('Test error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ─── API: Export to CSV ─────────────────────────────────────────────────────
app.post('/api/export/csv', (req, res) => {
    try {
        const { results } = req.body;
        if (!results || results.length === 0) {
            return res.status(400).json({ error: 'No results to export' });
        }

        const fields = ['userId', 'password', 'success', 'reason', 'url', 'durationMs', 'timestamp'];
        const parser = new Parser({ fields });
        const csv = parser.parse(results);

        const filename = `credentials_export_${Date.now()}.csv`;
        const filepath = path.join(exportsDir, filename);
        fs.writeFileSync(filepath, csv);

        res.json({
            success: true,
            filename,
            data: csv,
            downloadUrl: `/exports/${filename}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── API: Export to Excel ───────────────────────────────────────────────────
app.post('/api/export/excel', async (req, res) => {
    try {
        const { results } = req.body;
        if (!results || results.length === 0) {
            return res.status(400).json({ error: 'No results to export' });
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Credential Results');

        worksheet.columns = [
            { header: 'User ID', key: 'userId', width: 20 },
            { header: 'Password', key: 'password', width: 20 },
            { header: 'Success', key: 'success', width: 15 },
            { header: 'Reason', key: 'reason', width: 45 },
            { header: 'URL', key: 'url', width: 50 },
            { header: 'Duration (ms)', key: 'durationMs', width: 18 },
            { header: 'Timestamp', key: 'timestamp', width: 25 }
        ];

        results.forEach(result => {
            worksheet.addRow({
                userId: result.userId,
                password: result.password,
                success: result.success ? '✅ Yes' : '❌ No',
                reason: result.reason || result.error || '',
                url: result.url || '',
                durationMs: result.durationMs || 0,
                timestamp: result.timestamp || new Date().toISOString()
            });
        });

        // Style header
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E8F0' }
        };

        // Conditional row coloring
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                const successCell = row.getCell(3);
                if (successCell.value === '✅ Yes') {
                    successCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFD4EDDA' }
                    };
                } else {
                    successCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF8D7DA' }
                    };
                }
            }
        });

        const filename = `credentials_export_${Date.now()}.xlsx`;
        const filepath = path.join(exportsDir, filename);
        await workbook.xlsx.writeFile(filepath);

        const buffer = await workbook.xlsx.writeBuffer();
        const base64 = buffer.toString('base64');

        res.json({
            success: true,
            filename,
            data: base64,
            downloadUrl: `/exports/${filename}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── Serve exports & SPA fallback ───────────────────────────────────────────
app.use('/exports', express.static(exportsDir));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Exports saved to: ${exportsDir}`);
    console.log(`🔒 Max combinations per request: ${MAX_COMBINATIONS}`);
});
