// background.js - Service worker that runs in the background and handles extension lifecycle events
chrome.runtime.onInstalled.addListener(() => {
    console.log("HTML to CSV Exporter installed.");
});

// Listen for tab updates to detect when user navigates to a LinkedIn company page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only proceed if the page has finished loading and has a URL
    if (changeInfo.status === 'complete' && tab.url) {
        // Check if this is a LinkedIn company page
        if (checkIfCompanyPage(tab.url)) {
            console.log("LinkedIn company page detected, pre-fetching data...");

            // Execute the company data scraping function
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: findCompanyData
            }, (results) => {
                if (results && results[0].result) {
                    const companyData = results[0].result;

                    // Store the company data in local storage for the popup to use
                    chrome.storage.local.set({
                        preloadedCompanyData: companyData,
                        preloadedCompanyUrl: tab.url
                    });

                    // Specifically store the website URL for use with employee data
                    if (companyData.website) {
                        chrome.storage.local.set({
                            currentCompanyWebsite: companyData.website
                        });
                        console.log("Company website stored:", companyData.website);
                    }

                    console.log("Company data pre-loaded successfully");
                }
            });
        }
    }
});

// Also listen for tab activation to update the current company website if needed
chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab.url && checkIfCompanyPage(tab.url)) {
            console.log("Switched to company page tab, updating company data...");

            chrome.scripting.executeScript({
                target: { tabId: activeInfo.tabId },
                function: findCompanyData
            }, (results) => {
                if (results && results[0].result) {
                    const companyData = results[0].result;

                    // Store the company data in local storage for the popup to use
                    chrome.storage.local.set({
                        preloadedCompanyData: companyData,
                        preloadedCompanyUrl: tab.url
                    });

                    // Specifically store the website URL for use with employee data
                    if (companyData.website) {
                        chrome.storage.local.set({
                            currentCompanyWebsite: companyData.website
                        });
                        console.log("Company website updated:", companyData.website);
                    }
                }
            });
        }
    });
});

// Function to check if current URL is a company page
function checkIfCompanyPage(url) {
    return url.includes('/company/') || url.includes('/sales/company/');
}

// Function to find company data - same as in popup.js
function findCompanyData() {
    return new Promise((resolve) => {
        try {
            const companyName = document.querySelector('[data-anonymize="company-name"]')?.textContent?.trim() || '';
            const industry = document.querySelector('[data-anonymize="industry"]')?.textContent?.trim() || '';
            const location = document.querySelector('[data-anonymize="location"]')?.textContent?.trim() || '';

            // Get website URL - look for "Visit website" link
            let website = '';
            const visitWebsiteLink = document.querySelector('a[aria-label="Visit website"]');
            if (visitWebsiteLink && visitWebsiteLink.href) {
                website = visitWebsiteLink.href;
            } else {
                // Try to find any element containing "website" text
                const allLinks = Array.from(document.querySelectorAll('a'));
                const websiteLink = allLinks.find(link =>
                    link.textContent.toLowerCase().includes('visit website') ||
                    link.textContent.toLowerCase().includes('website')
                );

                if (websiteLink && websiteLink.href) {
                    website = websiteLink.href;
                }
            }

            const metrics = {
                allEmployees: { count: '0', link: '' },
                southAmerica: { count: '0', link: '' },
                decisionMakers: { count: '0', link: '' },
                philippines: '0',
                hhrr: '0',
                argentina: { count: '0', link: '' },
                venezuela: { count: '0', link: '' },
                brazil: { count: '0', link: '' },
                colombia: { count: '0', link: '' }
            };

            // Find all metric links
            document.querySelectorAll('._search-links--link_mb60vc a').forEach(link => {
                const text = link.textContent.trim();
                if (text.includes('All employees')) {
                    metrics.allEmployees = {
                        count: text.match(/\((\d+)\)/)?.[1] || '0',
                        link: link.href
                    };
                }
                if (text.includes('South America') && !text.includes('Acc/Fin')) {
                    metrics.southAmerica = {
                        count: text.match(/\((\d+)\)/)?.[1] || '0',
                        link: link.href
                    };
                }
                if (text.includes('Decision makers')) {
                    metrics.decisionMakers = {
                        count: text.match(/\((\d+)\)/)?.[1] || '0',
                        link: link.href
                    };
                }
                if (text.includes('Argentina')) {
                    metrics.argentina = {
                        count: text.match(/\((\d+)\)/)?.[1] || '0',
                        link: link.href
                    };
                }
                if (text.includes('Venezuela')) {
                    metrics.venezuela = {
                        count: text.match(/\((\d+)\)/)?.[1] || '0',
                        link: link.href
                    };
                }
                if (text.includes('Brazil')) {
                    metrics.brazil = {
                        count: text.match(/\((\d+)\)/)?.[1] || '0',
                        link: link.href
                    };
                }
                if (text.includes('Colombia')) {
                    metrics.colombia = {
                        count: text.match(/\((\d+)\)/)?.[1] || '0',
                        link: link.href
                    };
                }
            });

            resolve({
                name: companyName,
                description: `${industry} company`,
                location: location,
                website: website,
                metrics: metrics
            });
        } catch (e) {
            console.error('Error in findCompanyData:', e);
            resolve({
                name: 'Error retrieving company data',
                description: '',
                location: '',
                website: '',
                metrics: {
                    allEmployees: { count: '0', link: '' },
                    southAmerica: { count: '0', link: '' },
                    decisionMakers: { count: '0', link: '' },
                    philippines: '0',
                    hhrr: '0',
                    argentina: { count: '0', link: '' },
                    venezuela: { count: '0', link: '' },
                    brazil: { count: '0', link: '' },
                    colombia: { count: '0', link: '' }
                }
            });
        }
    });
}
