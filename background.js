// background.js - Service worker that runs in the background and handles extension lifecycle events
chrome.runtime.onInstalled.addListener(() => {
    console.log("HTML to CSV Exporter installed.");
});
