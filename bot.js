// ==========================================================
// BTCUSDT ICT LIQUIDITY + FVG BOT
// FULL FIXED VERSION
// ==========================================================

require("dotenv").config();

const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const WebSocket = require("ws");
const axios = require("axios");

const {
    EMA,
    ATR
} = require("technicalindicators");

// ==========================================================
// TELEGRAM
// ==========================================================

const telegram = new TelegramBot(
    process.env.TELEGRAM_BOT_TOKEN,
    { polling: false }
);

// ==========================================================
// CONFIG
// ==========================================================

const CONFIG = {

    SYMBOL: "btcusdt",

    INTERVAL: "1m",

    EMA_LENGTH: 200,

    ATR_LENGTH: 14,

    SWING_LENGTH: 5,

    ATR_MULTIPLIER: 1.5,

    RISK_REWARD: 2.0,

    MIN_FVG_GAP: 0.0015,

    VOLUME_MULTIPLIER: 1.5,

    EMA_SLOPE_LOOKBACK: 5,

    EMA_SLOPE_THRESHOLD: 50,

    COOLDOWN_CANDLES: 3,

    MAX_CANDLES: 500
};

// ==========================================================
// STRATEGY
// ==========================================================

class ICTStrategy {

    constructor() {

        this.candles = [];

        this.lastSwingHigh = null;

        this.lastSwingLow = null;

        this.lastTradeIndex = -100;
    }

    // ======================================================
    // ADD CANDLE
    // ======================================================

    addCandle(candle) {

        this.candles.push(candle);

        if (
            this.candles.length >
            CONFIG.MAX_CANDLES
        ) {
            this.candles.shift();
        }
    }

    // ======================================================
    // PIVOT HIGH
    // ======================================================

    detectPivotHigh(highs, length) {

        const pivotIndex =
            highs.length - 1 - length;

        if (pivotIndex < length) {
            return null;
        }

        const pivotHigh =
            highs[pivotIndex];

        for (
            let i = pivotIndex - length;
            i <= pivotIndex + length;
            i++
        ) {

            if (i === pivotIndex) {
                continue;
            }

            if (highs[i] >= pivotHigh) {
                return null;
            }
        }

        return pivotHigh;
    }

    // ======================================================
    // PIVOT LOW
    // ======================================================

    detectPivotLow(lows, length) {

        const pivotIndex =
            lows.length - 1 - length;

        if (pivotIndex < length) {
            return null;
        }

        const pivotLow =
            lows[pivotIndex];

        for (
            let i = pivotIndex - length;
            i <= pivotIndex + length;
            i++
        ) {

            if (i === pivotIndex) {
                continue;
            }

            if (lows[i] <= pivotLow) {
                return null;
            }
        }

        return pivotLow;
    }

    // ======================================================
    // ACTIVE SESSION
    // ======================================================

    isActiveSession() {

        const utcHour =
            new Date().getUTCHours();

        return (
            utcHour >= 7 &&
            utcHour <= 21
        );
    }

    // ======================================================
    // SIGNAL LOGIC
    // ======================================================

    getSignal() {

        if (
            this.candles.length <
            CONFIG.EMA_LENGTH + 10
        ) {
            return null;
        }

        const closes =
            this.candles.map(c => c.close);

        const highs =
            this.candles.map(c => c.high);

        const lows =
            this.candles.map(c => c.low);

        const volumes =
            this.candles.map(c => c.volume);

        const current =
            this.candles[
                this.candles.length - 1
            ];

        const prev2 =
            this.candles[
                this.candles.length - 3
            ];

        // ==================================================
        // EMA
        // ==================================================

        const emaValues = EMA.calculate({

            period: CONFIG.EMA_LENGTH,

            values: closes
        });

        const ema200 =
            emaValues[
                emaValues.length - 1
            ];

        const emaPast =
            emaValues[
                emaValues.length -
                CONFIG.EMA_SLOPE_LOOKBACK
            ];

        const emaSlope =
            ema200 - emaPast;

        const bullTrend =
            current.close > ema200;

        const bearTrend =
            current.close < ema200;

        const strongBullTrend =
            emaSlope >
            CONFIG.EMA_SLOPE_THRESHOLD;

        const strongBearTrend =
            emaSlope <
            -CONFIG.EMA_SLOPE_THRESHOLD;

        // ==================================================
        // ATR
        // ==================================================

        const atrValues = ATR.calculate({

            high: highs,

            low: lows,

            close: closes,

            period: CONFIG.ATR_LENGTH
        });

        const atr =
            atrValues[
                atrValues.length - 1
            ];

        // ==================================================
        // PIVOTS
        // ==================================================

        const pivotHigh =
            this.detectPivotHigh(
                highs,
                CONFIG.SWING_LENGTH
            );

        const pivotLow =
            this.detectPivotLow(
                lows,
                CONFIG.SWING_LENGTH
            );

        if (pivotHigh) {
            this.lastSwingHigh =
                pivotHigh;
        }

        if (pivotLow) {
            this.lastSwingLow =
                pivotLow;
        }

        // ==================================================
        // LIQUIDITY SWEEPS
        // ==================================================

        const bullLiquiditySweep =

            this.lastSwingLow &&

            current.low <
            this.lastSwingLow &&

            current.close >
            this.lastSwingLow;

        const bearLiquiditySweep =

            this.lastSwingHigh &&

            current.high >
            this.lastSwingHigh &&

            current.close <
            this.lastSwingHigh;

        // ==================================================
        // DISPLACEMENT
        // ==================================================

        const bodySize =
            Math.abs(
                current.close -
                current.open
            );

        const candleRange =
            current.high -
            current.low;

        const strongBullDisplacement =

            current.close >
            current.open &&

            bodySize >
            candleRange * 0.6;

        const strongBearDisplacement =

            current.close <
            current.open &&

            bodySize >
            candleRange * 0.6;

        // ==================================================
        // FVG
        // ==================================================

        const bullGap =

            (
                current.low -
                prev2.high
            ) / prev2.high;

        const bearGap =

            (
                prev2.low -
                current.high
            ) / prev2.low;

        const bullFVG =

            current.low >
            prev2.high &&

            bullGap >
            CONFIG.MIN_FVG_GAP &&

            strongBullDisplacement;

        const bearFVG =

            current.high <
            prev2.low &&

            bearGap >
            CONFIG.MIN_FVG_GAP &&

            strongBearDisplacement;

        // ==================================================
        // VOLUME
        // ==================================================

        const avgVolume =

            volumes
                .slice(-20)
                .reduce((a, b) => a + b, 0) / 20;

        const highVolume =

            current.volume >

            avgVolume *
            CONFIG.VOLUME_MULTIPLIER;

        // ==================================================
        // COOLDOWN
        // ==================================================

        const currentIndex =
            this.candles.length;

        const cooldownPassed =

            currentIndex -
            this.lastTradeIndex >

            CONFIG.COOLDOWN_CANDLES;

        // ==================================================
        // SESSION
        // ==================================================

        const activeSession =
            this.isActiveSession();

        // ==================================================
        // LONG CONDITION
        // ==================================================

        const longCondition =

            activeSession &&

            cooldownPassed &&

            bullTrend &&

            strongBullTrend &&

            bullLiquiditySweep &&

            bullFVG &&

            highVolume;

        // ==================================================
        // SHORT CONDITION
        // ==================================================

        const shortCondition =

            activeSession &&

            cooldownPassed &&

            bearTrend &&

            strongBearTrend &&

            bearLiquiditySweep &&

            bearFVG &&

            highVolume;

        // ==================================================
        // LONG
        // ==================================================

        if (longCondition) {

            this.lastTradeIndex =
                currentIndex;

            const stopLoss =

                current.close -

                (
                    atr *
                    CONFIG.ATR_MULTIPLIER
                );

            const takeProfit =

                current.close +

                (
                    (
                        current.close -
                        stopLoss
                    ) *

                    CONFIG.RISK_REWARD
                );

            return {

                side: "LONG",

                entry: current.close,

                stopLoss,

                takeProfit
            };
        }

        // ==================================================
        // SHORT
        // ==================================================

        if (shortCondition) {

            this.lastTradeIndex =
                currentIndex;

            const stopLoss =

                current.close +

                (
                    atr *
                    CONFIG.ATR_MULTIPLIER
                );

            const takeProfit =

                current.close -

                (
                    (
                        stopLoss -
                        current.close
                    ) *

                    CONFIG.RISK_REWARD
                );

            return {

                side: "SHORT",

                entry: current.close,

                stopLoss,

                takeProfit
            };
        }

        return null;
    }
}

// ==========================================================
// BOT
// ==========================================================

class TradingBot {

    constructor() {

        this.strategy =
            new ICTStrategy();

        this.position = null;

        this.stats = {

            wins: 0,

            losses: 0
        };

        this.start();
    }

    // ======================================================
    // START
    // ======================================================

    async start() {

        await this.loadHistory();

        this.connect();
    }

    // ======================================================
    // LOAD HISTORY
    // ======================================================

    async loadHistory() {

        const url =

            `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${CONFIG.INTERVAL}&limit=500`;

        const response =
            await axios.get(url);

        const candles =
            response.data;

        candles.forEach(c => {

            this.strategy.addCandle({

                open: parseFloat(c[1]),

                high: parseFloat(c[2]),

                low: parseFloat(c[3]),

                close: parseFloat(c[4]),

                volume: parseFloat(c[5])
            });
        });

        console.log(
            `✅ Loaded ${candles.length} historical candles`
        );
    }

    // ======================================================
    // TELEGRAM
    // ======================================================

    async sendTelegram(message) {

        try {

            await telegram.sendMessage(

                process.env.TELEGRAM_CHAT_ID,

                message
            );

        } catch (err) {

            console.log(
                "Telegram Error:",
                err.message
            );
        }
    }

    // ======================================================
    // LOG TRADE
    // ======================================================

    logTrade(trade) {

        let trades = [];

        try {

            const data =
                fs.readFileSync(
                    "trades.json"
                );

            trades =
                JSON.parse(data);

        } catch {}

        trades.push(trade);

        fs.writeFileSync(

            "trades.json",

            JSON.stringify(
                trades,
                null,
                2
            )
        );
    }

    // ======================================================
    // STATS
    // ======================================================

    printStats() {

        const total =

            this.stats.wins +
            this.stats.losses;

        const winRate =

            total > 0

            ? (
                this.stats.wins /
                total * 100
            ).toFixed(2)

            : 0;

        console.log("\n");

        console.log(
            "======================"
        );

        console.log(
            `WINS: ${this.stats.wins}`
        );

        console.log(
            `LOSSES: ${this.stats.losses}`
        );

        console.log(
            `WIN RATE: ${winRate}%`
        );

        console.log(
            "======================"
        );

        console.log("\n");
    }

    // ======================================================
    // CONNECT
    // ======================================================

    connect() {

        const url =

            `wss://stream.binance.com:9443/ws/${CONFIG.SYMBOL}@kline_${CONFIG.INTERVAL}`;

        this.ws =
            new WebSocket(url);

        this.ws.on("open", () => {

            console.log(
                "✅ Connected to Binance"
            );
        });

        this.ws.on(

            "message",

            async (data) =>
                await this.onMessage(data)
        );

        this.ws.on("close", () => {

            console.log(
                "❌ WebSocket Closed"
            );

            setTimeout(() => {

                this.connect();

            }, 5000);
        });

        this.ws.on("error", (err) => {

            console.log(
                "Socket Error:",
                err.message
            );
        });
    }

    // ======================================================
    // HANDLE MESSAGE
    // ======================================================

    async onMessage(data) {

        const json =
            JSON.parse(data);

        const kline =
            json.k;

        // ONLY CLOSED CANDLE

        if (!kline.x) {
            return;
        }

        const candle = {

            open: parseFloat(kline.o),

            high: parseFloat(kline.h),

            low: parseFloat(kline.l),

            close: parseFloat(kline.c),

            volume: parseFloat(kline.v)
        };

        console.log(
            `CLOSE: ${candle.close}`
        );

        this.strategy.addCandle(candle);

        // ==================================================
        // SIGNAL
        // ==================================================

        const signal =
            this.strategy.getSignal();

        if (
            signal &&
            !this.position
        ) {

            this.position =
                signal;

            console.log("\n");

            console.log(
                "======================"
            );

            console.log(
                `🚀 ${signal.side} ENTRY`
            );

            console.log(
                `ENTRY: ${signal.entry}`
            );

            console.log(
                `SL: ${signal.stopLoss}`
            );

            console.log(
                `TP: ${signal.takeProfit}`
            );

            console.log(
                "======================"
            );

            console.log("\n");

            await this.sendTelegram(

`🚀 NEW ${signal.side} TRADE

ENTRY: ${signal.entry}

STOP LOSS: ${signal.stopLoss}

TAKE PROFIT: ${signal.takeProfit}`
            );

            this.logTrade({

                type: "ENTRY",

                side: signal.side,

                entry: signal.entry,

                stopLoss: signal.stopLoss,

                takeProfit: signal.takeProfit,

                time: new Date()
            });
        }

        // ==================================================
        // MANAGE POSITION
        // ==================================================

        if (this.position) {

            await this.manageTrade(
                candle.close
            );
        }
    }

    // ======================================================
    // TRADE MANAGEMENT
    // ======================================================

    async manageTrade(price) {

        const p =
            this.position;

        // ==================================================
        // LONG
        // ==================================================

        if (p.side === "LONG") {

            // STOP LOSS

            if (price <= p.stopLoss) {

                console.log(
                    "❌ LONG SL HIT"
                );

                await this.sendTelegram(

`❌ LONG STOP LOSS HIT

EXIT PRICE: ${price}`
                );

                this.stats.losses++;

                this.logTrade({

                    type: "SL",

                    side: "LONG",

                    price,

                    time: new Date()
                });

                this.printStats();

                this.position = null;
            }

            // TAKE PROFIT

            else if (
                price >= p.takeProfit
            ) {

                console.log(
                    "✅ LONG TP HIT"
                );

                await this.sendTelegram(

`✅ LONG TAKE PROFIT HIT

EXIT PRICE: ${price}`
                );

                this.stats.wins++;

                this.logTrade({

                    type: "TP",

                    side: "LONG",

                    price,

                    time: new Date()
                });

                this.printStats();

                this.position = null;
            }
        }

        // ==================================================
        // SHORT
        // ==================================================

        if (p.side === "SHORT") {

            // STOP LOSS

            if (price >= p.stopLoss) {

                console.log(
                    "❌ SHORT SL HIT"
                );

                await this.sendTelegram(

`❌ SHORT STOP LOSS HIT

EXIT PRICE: ${price}`
                );

                this.stats.losses++;

                this.logTrade({

                    type: "SL",

                    side: "SHORT",

                    price,

                    time: new Date()
                });

                this.printStats();

                this.position = null;
            }

            // TAKE PROFIT

            else if (
                price <= p.takeProfit
            ) {

                console.log(
                    "✅ SHORT TP HIT"
                );

                await this.sendTelegram(

`✅ SHORT TAKE PROFIT HIT

EXIT PRICE: ${price}`
                );

                this.stats.wins++;

                this.logTrade({

                    type: "TP",

                    side: "SHORT",

                    price,

                    time: new Date()
                });

                this.printStats();

                this.position = null;
            }
        }
    }
}

// ==========================================================
// START BOT
// ==========================================================

new TradingBot();