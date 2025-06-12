const express = require('express');
const axios = require('axios');

const app = express();
const port = 3001;

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