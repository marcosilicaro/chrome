// content.js - Content script that runs in the webpage context to find and return person names from spans
function findNames() {
    let spans = document.querySelectorAll('span[data-anonymize="person-name"]');
    if (!spans.length) {
        return ['No person names found on this page.'];
    }

    return Array.from(spans).map(span => span.innerText.trim());
}

// Send the names back to the popup
chrome.runtime.sendMessage({ names: findNames() });
