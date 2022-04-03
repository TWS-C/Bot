import fetch from 'node-fetch';
import getPixels from "get-pixels";
import WebSocket from 'ws';
import ndarray from "ndarray";
import fs from 'fs';

const args = process.argv.slice(2);

if (args.length !== 1 && !process.env.REDDIT_SESSION)
{
    log("Missing reddit_session cookie.");
    process.exit(1);
}
let redditSessionCookies = (process.env.REDDIT_SESSION || args[0]).split(';');
if (redditSessionCookies.length > 4)
{
    log("Having more than 4 reddit accounts per IP address is not advised!");
}
let hasTokens = false;
let accessTokens;
let defaultAccessToken;

let hasOrders   = false;
let placeOrders = [];

/**
 * @typedef {Object} Color
 * @property {number} id
 * @property {string} name
 * @property {string} hex
 */
/**
 * @type {Color[]}
 */
const COLOR_MAPPINGS = [
    {hex: '#BE0039', id: 1, name: 'dark red'},
    {hex: '#FF4500', id: 2, name: 'red'},
    {hex: '#FFA800', id: 3, name: 'orange'},
    {hex: '#FFD635', id: 4, name: 'yellow'},
    {hex: '#00A368', id: 6, name: 'dark green'},
    {hex: '#00CC78', id: 7, name: 'green'},
    {hex: '#7EED56', id: 8, name: 'light green'},
    {hex: '#00756F', id: 9, name: 'dark teal'},
    {hex: '#009EAA', id: 10, name: 'teal'},
    {hex: '#2450A4', id: 12, name: 'dark blue'},
    {hex: '#3690EA', id: 13, name: 'blue'},
    {hex: '#51E9F4', id: 14, name: 'light blue'},
    {hex: '#493AC1', id: 15, name: 'indigo'},
    {hex: '#6A5CFF', id: 16, name: 'periwinkle'},
    {hex: '#811E9F', id: 18, name: 'dark purple'},
    {hex: '#B44AC0', id: 19, name: 'purple'},
    {hex: '#FF3881', id: 22, name: 'pink'},
    {hex: '#FF99AA', id: 23, name: 'light pink'},
    {hex: '#6D482F', id: 24, name: 'dark brown'},
    {hex: '#9C6926', id: 25, name: 'brown'},
    {hex: '#000000', id: 27, name: 'black'},
    {hex: '#898D90', id: 29, name: 'gray'},
    {hex: '#D4D7D9', id: 30, name: 'light gray'},
    {hex: '#FFFFFF', id: 31, name: 'white'},
];

(async function ()
{
    await refreshTokens();
    setInterval(updateOrders, 5 * 60 * 1000); // Update orders every 5 minutes.
    await updateOrders();
    await startPlacement();
})();

async function refreshTokens()
{
    let tokens = [];
    for (const cookie of redditSessionCookies)
    {
        let response = await fetch("https://www.reddit.com/r/place/", {
            'headers': {
                'cookie': `reddit_session=${cookie}`
            }
        });
        tokens.push((await response.text()).split('\"accessToken\":\"')[1].split('"')[0]);
    }

    log(`Refreshed tokens: ${tokens}`)
    accessTokens       = tokens;
    defaultAccessToken = tokens[0]
    hasTokens          = true;

    // Refresh the tokens every 30 minutes.
    setInterval(refreshTokens, 30 * 60 * 1000);
}

function startPlacement()
{
    if (!hasTokens)
    {
        setTimeout(startPlacement, 1000);
        return;
    }

    // Try to stagger pixel placement
    let interval = 300 / accessTokens.length;
    let delay    = 0;
    for (let accessToken of accessTokens)
    {
        setTimeout(() => attemptPlace(accessToken), delay * 1000);
        delay += interval;
    }
}

async function attemptPlace(accessToken = defaultAccessToken)
{
    let retry = () => attemptPlace(accessToken);
    if (!hasOrders)
    {
        setTimeout(retry, 2000);
        return;
    }
    let currentMap;
    try
    {
        const canvasUrl = await getCurrentImageUrl();
        currentMap      = await getMapFromUrl(canvasUrl);
    }
    catch (e)
    {
        log(`Failed to retrieve canvas: ${e}`);
        setTimeout(retry, 15000);
        return;
    }

    for (const order of placeOrders)
    {
        let x              = order[0];
        let y              = order[1];
        let color          = getColor(order[2]);
        let rgbaAtLocation = getRgbaAtLocation(currentMap, x, y);
        let currentColor   = getClosestColor(rgbaAtLocation[0], rgbaAtLocation[1], rgbaAtLocation[2]);

        if (typeof currentColor === 'undefined')
        {
            const hex = rgbToHex(rgbaAtLocation[0], rgbaAtLocation[1], rgbaAtLocation[2]);
            log(`Pixel at ${x} ${y} has undefined color (${hex}). Replacing with ${color.name}.`);
        }
        else if (currentColor.id === color.id)
        {
            continue;
        }
        else
        {
            log(`Pixel at (${x},${y}) is ${currentColor.name} but needs to be ${color.name}.`);
        }

        const res  = await place(x, y, color.id, accessToken);
        const data = await res.json();
        try
        {
            if (data.errors)
            {
                const error         = data.errors[0];
                const nextPixel     = error.extensions.nextAvailablePixelTs + 3000;
                const nextPixelDate = new Date(nextPixel);
                const delay         = nextPixelDate.getTime() - Date.now();
                log(`Tried placing pixel too soon! Next pixel is placed at ${nextPixelDate.toLocaleTimeString()}.`)
                setTimeout(retry, delay);
            }
            else
            {
                const nextPixel     = data.data.act.data[0].data.nextAvailablePixelTimestamp + 3000;
                const nextPixelDate = new Date(nextPixel);
                const delay         = nextPixelDate.getTime() - Date.now();
                log(`Successfully placed ${color.name} pixel on ${x}, ${y}. Next pixel is placed at ${nextPixelDate.toLocaleTimeString()}.`)
                setTimeout(retry, delay);
            }
        }
        catch (e)
        {
            log(`Error in response analysis ${e}`);
            setTimeout(retry, 10000);
        }

        return;
    }

    log('All the pixels are already in the right place!')
    setTimeout(retry, 5000);
}

function updateOrders()
{
    log('Loading new placement orders.');
    fetch('https://cdn.scoresaber.com/downloads/placeOrders.json')
        .then(async (response) =>
        {
            if (!response.ok)
            {
                return log('Could not load new placement orders! (non-ok status code)');
            }
            let data = await response.json();

            if (JSON.stringify(data) !== JSON.stringify(placeOrders))
            {
                log(`Loaded new placement orders. Total pixel count: ${data.length}.`);
            }

            placeOrders = data;
            hasOrders   = true;
        })
        .catch((e) => log(`Could not load new placement orders! ${e}`));
}

function place(x, y, colorId, accessToken = defaultAccessToken)
{
    try
    {
        return fetch('https://gql-realtime-2.reddit.com/query', {
            method:  'POST',
            body:    JSON.stringify({
                'operationName': 'setPixel',
                'variables':     {
                    'input': {
                        'actionName':       'r/replace:set_pixel',
                        'PixelMessageData': {
                            'coordinate':  {
                                'x': x,
                                'y': y
                            },
                            'colorIndex':  colorId,
                            'canvasIndex': 0
                        }
                    }
                },
                'query':         'mutation setPixel($input: ActInput!) {\n  act(input: $input) {\n    data {\n      ... on BasicMessage {\n        id\n        data {\n          ... on GetUserCooldownResponseMessageData {\n            nextAvailablePixelTimestamp\n            __typename\n          }\n          ... on SetPixelResponseMessageData {\n            timestamp\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n'
            }),
            headers: {
                'origin':                    'https://hot-potato.reddit.com',
                'referer':                   'https://hot-potato.reddit.com/',
                'apollographql-client-name': 'mona-lisa',
                'Authorization':             `Bearer ${accessToken}`,
                'Content-Type':              'application/json'
            }
        });
    }
    catch (e)
    {
        log('Failed to place pixel. Refreshing access tokens.');
        // noinspection JSIgnoredPromiseFromCall
        refreshTokens();
    }
}

async function getCurrentImageUrl(accessToken = defaultAccessToken)
{
    return new Promise((resolve, reject) =>
    {
        const ws = new WebSocket('wss://gql-realtime-2.reddit.com/query', 'graphql-ws', {
            headers: {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:98.0) Gecko/20100101 Firefox/98.0",
                "Origin":     "https://hot-potato.reddit.com"
            }
        });

        ws.onopen = () =>
        {
            ws.send(JSON.stringify({
                'type':    'connection_init',
                'payload': {
                    'Authorization': `Bearer ${accessToken}`
                }
            }));

            ws.send(JSON.stringify({
                'id':      '1',
                'type':    'start',
                'payload': {
                    'variables':     {
                        'input': {
                            'channel': {
                                'teamOwner': 'AFD2022',
                                'category':  'CANVAS',
                                'tag':       '0'
                            }
                        }
                    },
                    'extensions':    {},
                    'operationName': 'replace',
                    'query':         'subscription replace($input: SubscribeInput!) {\n  subscribe(input: $input) {\n    id\n    ... on BasicMessage {\n      data {\n        __typename\n        ... on FullFrameMessageData {\n          __typename\n          name\n          timestamp\n        }\n      }\n      __typename\n    }\n    __typename\n  }\n}'
                }
            }));
        };

        ws.onmessage = (message) =>
        {
            const {data} = message;
            const parsed = JSON.parse(data);

            // TODO: ew
            if (!parsed.payload || !parsed.payload.data || !parsed.payload.data.subscribe || !parsed.payload.data.subscribe.data)
            {
                return;
            }

            ws.close();
            resolve(parsed.payload.data.subscribe.data.name);
        }


        ws.onerror = reject;
    });
}

/**
 * @typedef {{data: Uint8Array, shape: array, stride: array, offset: number}} PixelMap
 */
/**
 * @param url
 * @returns {Promise<PixelMap>}
 */
function getMapFromUrl(url)
{
    return new Promise((resolve, reject) =>
    {
        getPixels(url, function (err, pixels)
        {
            if (err)
            {
                log("Bad image path")
                reject()
                return
            }
            log(`Received pixel array. [${pixels.shape.slice()}]`)
            resolve(pixels)
        })
    });
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
function rgbToHex(r, g, b)
{
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/**
 * @param {string} hex
 * @returns {[r: number, g: number, b: number]}
 */
function hexToRgb(hex)
{
    let res = parseInt(hex.substring(1), 16);
    return [(res & parseInt('FF0000', 16)) >> 16, (res & parseInt('FF00', 16)) >> 8, res & parseInt('FF', 16)];
}

/**
 * Sometimes the bot misidentifies a color (for example #000000 can sometimes be read as #010100)
 * so we check if its at least somewhat close and treat it as equal
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {Color|null}
 */
function getClosestColor(r, g, b)
{
    return COLOR_MAPPINGS[
        COLOR_MAPPINGS.findIndex((color) =>
        {
            let rgb = hexToRgb(color.hex);
            return Math.abs(rgb[0] - r) + Math.abs(rgb[1] - g) + Math.abs(rgb[2] - b) <= 5;
        })
        ] || null;
}

/**
 * @param {number} id
 * @returns {Color|null}
 */
function getColor(id)
{
    return COLOR_MAPPINGS[COLOR_MAPPINGS.findIndex((color) => color.id === id)] || null;
}

/**
 * @param {PixelMap} pixelMap
 * @param {number} x
 * @param {number} y
 * @returns {[r: number, g: number, b: number, a: number]}
 */
function getRgbaAtLocation(pixelMap, x, y)
{
    let pos = (x + y * pixelMap.shape[0]) * pixelMap.shape[2];
    return [
        pixelMap.data[pos],
        pixelMap.data[pos + 1],
        pixelMap.data[pos + 2],
        pixelMap.data[pos + 3],
    ]
}

function log(message)
{
    message = `[${new Date().toLocaleTimeString()}] ${message}`;
    console.log(message);
    fs.appendFile('log.txt', message + '\n', err => { if (err) throw err });
}
