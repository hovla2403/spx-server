const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3001;

// Middleware để parse query parameters
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/tracking', async (req, res) => {
    try {
        const trackingInput = req.query.spx_tn;

        if (!trackingInput) {
            return res.status(400).json({ error: 'Tracking number(s) is required' });
        }

        // Xử lý input: chuỗi đơn hoặc danh sách (cách bởi dấu phẩy)
        const trackingNumbers = Array.isArray(trackingInput)
            ? trackingInput
            : typeof trackingInput === 'string'
                ? trackingInput.split(',').map(tn => tn.trim())
                : [trackingInput];

        if (trackingNumbers.length === 0) {
            return res.status(400).json({ error: 'No valid tracking numbers provided' });
        }
        // Gọi API cho từng mã vận đơn
        const results = await Promise.all(
            trackingNumbers.map(async (trackingNumber) => {
                try {
                    const response = await axios.get(
                        `https://spx.vn/shipment/order/open/order/get_order_info?spx_tn=${trackingNumber}&language_code=vi`,
                        { timeout: 5000 }
                    );

                    // Trích xuất dữ liệu trạng thái mới nhất
                    const records = response.data?.data?.sls_tracking_info?.records || [];
                    let description = 'Không rõ trạng thái';
                    let tracking_code = '';

                    if (records.length > 0) {
                        const firstRecord = records[0]; // Lấy bản ghi đầu tiên
                        tracking_code = firstRecord.tracking_code;
                        description = firstRecord.buyer_description || firstRecord.milestone_name || 'Không rõ trạng thái';
                        // const latest = records.reduce((a, b) => (a.actual_time > b.actual_time ? a : b));
                        // tracking_code = latest.tracking_code
                        // description = latest.buyer_description || latest.milestone_name || 'Không rõ trạng thái';
                    }

                    return {
                        tracking_code,
                        description
                    };
                } catch (error) {
                    console.error(`Error fetching tracking data for ${trackingNumber}:`, error.message);
                    return {
                        tracking_code: tracking_code,
                        description: `Lỗi: ${error.message}`
                    };
                }
            })
        );

        // Trả về kết quả
        return res.json({
            results,
            total: results.length,
            successCount: results.filter(r => !r.description.startsWith('Lỗi:')).length,
            errorCount: results.filter(r => r.description.startsWith('Lỗi:')).length
        });

    } catch (error) {
        console.error('Unexpected error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// Proxy GHN vì GHN chặn User-Agent mặc định của Google Apps Script.
app.post('/api/ghn-tracking', async (req, res) => {
    const orderCodes = Array.isArray(req.body?.order_codes)
        ? req.body.order_codes
        : [];

    if (orderCodes.length === 0 || orderCodes.length > 25) {
        return res.status(400).json({
            error: 'order_codes must contain between 1 and 25 tracking numbers'
        });
    }

    const ghnTrackingUrl =
        'https://fe-online-gateway.ghn.vn/order-tracking/public-api/client/tracking-logs';

    try {
        const results = await Promise.all(
            orderCodes.map(async (rawOrderCode) => {
                const orderCode = String(rawOrderCode || '').trim().toUpperCase();

                if (!/^[A-Z0-9]{8,12}$/.test(orderCode)) {
                    return {
                        order_code: orderCode,
                        status_name: 'Mã GHN không hợp lệ'
                    };
                }

                try {
                    const response = await axios.post(
                        ghnTrackingUrl,
                        { order_code: orderCode },
                        {
                            timeout: 10000,
                            headers: {
                                'Content-Type': 'application/json;charset=UTF-8',
                                'Accept': 'application/json, text/plain, */*',
                                'Origin': 'https://donhang.ghn.vn',
                                'Referer': 'https://donhang.ghn.vn/',
                                'User-Agent':
                                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                                    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                                    'Chrome/138.0.0.0 Safari/537.36'
                            }
                        }
                    );

                    const data = response.data?.data || {};
                    const orderInfo = data.order_info || {};
                    const trackingLogs = Array.isArray(data.tracking_logs)
                        ? data.tracking_logs
                        : [];
                    const latestLog = trackingLogs.length > 0
                        ? trackingLogs[trackingLogs.length - 1]
                        : {};

                    return {
                        order_code: orderCode,
                        status: orderInfo.status || latestLog.status || '',
                        status_name:
                            orderInfo.status_name ||
                            latestLog.status_name ||
                            orderInfo.status ||
                            latestLog.status ||
                            'Không có dữ liệu'
                    };
                } catch (error) {
                    const responseStatus = error.response?.status;
                    console.error(
                        `GHN ${orderCode}:`,
                        responseStatus || error.message
                    );

                    return {
                        order_code: orderCode,
                        status_name: 'Không có dữ liệu',
                        error: responseStatus
                            ? `GHN HTTP ${responseStatus}`
                            : error.message
                    };
                }
            })
        );

        return res.json({
            results,
            total: results.length
        });
    } catch (error) {
        console.error('Unexpected GHN proxy error:', error.message);
        return res.status(502).json({ error: 'Unable to connect to GHN' });
    }
});

// ✅ API nhận và gửi thông báo Discord
app.post('/api/notify', async (req, res) => {
    const { trackingNumber, note, message, status } = req.body;

    if (!trackingNumber || !message || !status) {
        return res.status(400).json({ error: 'Thiếu thông tin gửi thông báo' });
    }

    const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1376784789494825071/7gALtt8tAXqI5O6EBsK_jIiXctZ5CZmb2E3Nc_zo8uV8zJxF9q9XlIIikJhNaLKs4zt9"'; // 🔁 Thay bằng webhook thật

    const content = `📦 Đơn hàng **${trackingNumber}** ${note || ''} ${message}.\n➡️ Trạng thái: *${status}*`;

    try {
        await axios.post(DISCORD_WEBHOOK_URL, { content });
        res.json({ success: true });
    } catch (error) {
        console.error("Lỗi gửi Discord:", error.message);
        res.status(500).json({ error: "Lỗi khi gửi tới Discord" });
    }
});


app.get('/', (req, res) => {
    res.json({ "status": "ok" })
})
// Khởi động server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
