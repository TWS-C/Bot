# ScoreSaberBot (Based on PlaceNL Bot)

## User script bot

### Installation instructions

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Click on this link: [https://github.com/TWS-C/Bot/raw/master/ssDefender.user.js](https://github.com/TWS-C/Bot/raw/master/ssDefender.user.js). If all goes well, Tampermonkey should offer to install a user script. Click on **Install**.
3. Reload your **r/place** tab. If all went well, you will see "Retrieving access token..." at the top right of your screen. The bot is now active, and will keep you informed of what it is doing via these notifications at the top right of your screen.

### Disadvantages of this bot

- When the bot places a pixel, it will look to you as if you can still place a pixel, while the bot has already done this for you (and you are therefore in the 5 minute cooldown). The cooldown is therefore displayed at the top right of your screen.

## Headless bot

### Getting your access token
1. Go to [r/place](https://www.reddit.com/r/place/)
2. Open the browser console (F12 / Right click -> Inspect -> Click on console)
3. Paste the following code and press enter:

```js
async function getAccessToken() {
	const usingOldReddit = window.location.href.includes('new.reddit.com');
	const url = usingOldReddit ? 'https://new.reddit.com/r/place/' : 'https://www.reddit.com/r/place/';
	const response = await fetch(url);
	const responseText = await response.text();

	return responseText.split('\"accessToken\":\"')[1].split('"')[0];
}

await getAccessToken()
```
4. The text between the quotes (`"`) is your access token.

### Installation instructions

1. Install [NodeJS](https://nodejs.org/).
2. Download the bot via [this link](https://github.com/TWS-C/Bot/archive/refs/heads/master.zip).
3. Unpack the bot to a folder somewhere on your computer.
4. Open a command prompt/terminal in this folder
    - Windows: `Shift + Right click` in the folder -> Click on "Open PowerShell window here"
    - Mac: Really no idea. Sorry!
    - Linux: Not really necessary, right?
5. Install the necessary dependencies with `npm i`
6. Execute the bot with `node bot.js ACCESS_TOKEN_HERE`
7. BONUS: You can do the last two steps as many times as you want for additional accounts. Just make sure you use different accounts otherwise it doesn't make much sense.
