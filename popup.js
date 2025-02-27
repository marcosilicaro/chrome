// popup.js - Handles user interaction in the extension popup and displays the found names and companies
document.addEventListener('DOMContentLoaded', function () {
    // Add loading handler
    const exportButton = document.getElementById('exportCsv');
    const originalClickHandler = exportButton.onclick;

    exportButton.onclick = function () {
        const dataList = document.getElementById('dataList');
        const loadingTemplate = document.getElementById('loading-template');
        dataList.innerHTML = loadingTemplate.innerHTML;

        if (originalClickHandler) {
            originalClickHandler.call(this);
        }
    };

    const dataList = document.getElementById('dataList');
    const clearButton = document.getElementById('clearData');

    // First try to load any existing data
    chrome.storage.local.get(['linkedinData', 'currentTabId'], function (result) {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const currentTabId = tabs[0].id;

            // Only show stored data if it's from the same tab
            if (result.linkedinData && result.currentTabId === currentTabId) {
                displayProfiles(result.linkedinData, true);
            }
        });
    });

    // Add clear button functionality
    clearButton.addEventListener('click', () => {
        // Clear the table
        dataList.innerHTML = '<tr><td colspan="3" class="empty-state">Click "Show LinkedIn Data" to view profiles</td></tr>';
        document.getElementById('profileCount').textContent = '0'; // Reset count when clearing

        // Clear the stored data for current tab
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.storage.local.set({
                linkedinData: null,
                currentTabId: tabs[0].id
            });
        });
    });

    // Initial count update when popup opens
    updateProfileCount();

    // Add search functionality
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', function () {
        const searchTerm = this.value.toLowerCase();
        const rows = dataList.getElementsByTagName('tr');

        for (let row of rows) {
            // Skip rows with loading or empty state classes
            if (row.querySelector('.loading') || row.querySelector('.empty-state')) {
                continue;
            }

            const nameCell = row.cells[0];
            if (nameCell) {
                const name = nameCell.textContent.toLowerCase();
                if (name.includes(searchTerm)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            }
        }

        // Update count to show only visible rows
        updateProfileCount();
    });

    // Update the export button click handler
    exportButton.addEventListener('click', () => {
        // Show loading state
        const loadingTemplate = document.getElementById('loading-template');
        dataList.innerHTML = loadingTemplate.innerHTML;

        // Query for the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTabUrl = tabs[0].url;

            // Check if we need to refresh
            chrome.storage.local.get(['lastScrapedUrl'], function (result) {
                if (needsRefresh(currentTabUrl, result.lastScrapedUrl)) {
                    // If page numbers are different, refresh the page first
                    chrome.tabs.reload(tabs[0].id, {}, function () {
                        // Wait for page to load then scrape
                        setTimeout(() => {
                            executeScrapingWithRetry(tabs[0].id, currentTabUrl);
                        }, 1000);  // Wait 1 second for page to load
                    });
                } else {
                    // If on same page or first scrape, proceed normally
                    executeScrapingWithRetry(tabs[0].id, currentTabUrl);
                }
            });
        });
    });
});

// Function to merge profiles and remove duplicates
function mergeProfiles(existing, newProfiles, currentPage) {
    // First, remove all existing profiles from the current page
    const filteredExisting = existing.filter(profile => profile.page !== currentPage);

    // Then add all new profiles
    return [...filteredExisting, ...newProfiles];
}

// Function to update the profile count
function updateProfileCount() {
    const rows = dataList.getElementsByTagName('tr');
    let count = 0;

    for (let row of rows) {
        if (!row.querySelector('.empty-state') &&
            !row.querySelector('.loading') &&
            row.style.display !== 'none') {
            count++;
        }
    }

    document.getElementById('profileCount').textContent = count;
}

// Function to create page navigation menu
function createPageNavigation(profiles) {
    // Get unique pages and sort them
    const pages = [...new Set(profiles.map(p => p.page))].sort((a, b) => parseInt(a) - parseInt(b));

    // Create or get the navigation container
    let navContainer = document.getElementById('page-nav');
    if (!navContainer) {
        navContainer = document.createElement('div');
        navContainer.id = 'page-nav';
        // Insert after search container
        const searchContainer = document.querySelector('.search-container');
        searchContainer.parentNode.insertBefore(navContainer, searchContainer.nextSibling);
    }

    // Style the navigation container
    navContainer.style.cssText = `
        margin: 10px 0;
        padding: 5px;
        border-radius: 4px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
    `;

    // Clear existing buttons
    navContainer.innerHTML = '';

    // Create page buttons
    pages.forEach(page => {
        const pageButton = document.createElement('button');
        pageButton.textContent = page;
        pageButton.style.cssText = `
            padding: 6px 12px;
            border: 1px solid #0073b1;
            background: white;
            color: #0073b1;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
        `;

        // Hover effects
        pageButton.addEventListener('mouseover', () => {
            pageButton.style.backgroundColor = '#0073b1';
            pageButton.style.color = 'white';
        });

        pageButton.addEventListener('mouseout', () => {
            pageButton.style.backgroundColor = 'white';
            pageButton.style.color = '#0073b1';
        });

        // Click handler to scroll to page section
        pageButton.addEventListener('click', () => {
            const rows = dataList.getElementsByTagName('tr');
            for (let row of rows) {
                const pageCell = row.cells[2]; // Third column
                if (pageCell && pageCell.textContent === `Page ${page}`) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'start' });

                    // Highlight the row briefly
                    const originalBackground = row.style.backgroundColor;
                    row.style.backgroundColor = '#e1f2ff';
                    setTimeout(() => {
                        row.style.backgroundColor = originalBackground;
                    }, 1000);

                    break;
                }
            }
        });

        navContainer.appendChild(pageButton);
    });
}

// Function to display profiles with sorting
function displayProfiles(profiles, isInitialLoad) {
    if (isInitialLoad) {
        dataList.innerHTML = '';
    }

    // Sort profiles by page number
    const sortedProfiles = profiles.sort((a, b) => {
        const pageA = parseInt(a.page) || 1;
        const pageB = parseInt(b.page) || 1;
        return pageA - pageB;
    });

    // Create the page navigation menu
    createPageNavigation(sortedProfiles);

    sortedProfiles.forEach(profile => {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        const companyCell = document.createElement('td');
        const pageCell = document.createElement('td');

        // Create name text
        nameCell.textContent = `${profile.firstName} ${profile.lastName}`.trim();

        // Create company cell content
        if (profile.company && profile.companyUrl) {
            const companyLink = document.createElement('a');
            companyLink.href = profile.companyUrl;
            companyLink.textContent = profile.company;
            companyLink.target = '_blank';
            companyLink.style.color = '#0077b5';
            companyLink.style.textDecoration = 'none';
            companyLink.addEventListener('mouseover', () => {
                companyLink.style.textDecoration = 'underline';
            });
            companyLink.addEventListener('mouseout', () => {
                companyLink.style.textDecoration = 'none';
            });
            companyCell.appendChild(companyLink);
        } else {
            companyCell.textContent = profile.company || '-';
            companyCell.style.backgroundColor = '#ffebee'; // Light red background
        }

        // Add page number
        pageCell.textContent = `Page ${profile.page}`;
        pageCell.style.textAlign = 'center';

        row.appendChild(nameCell);
        row.appendChild(companyCell);
        row.appendChild(pageCell);
        dataList.appendChild(row);
    });

    // Update the count after adding new profiles
    updateProfileCount();
}

// Function that will be injected into the page
function findProfileData() {
    return new Promise((resolve) => {
        // Wait for page to be fully loaded
        const checkPage = () => {
            const profilesDiv = document.getElementById('findymail-profiles');
            const url = window.location.href;

            if (!profilesDiv) {
                setTimeout(checkPage, 500); // Check again in 500ms
                return;
            }

            try {
                // Get page number from URL
                let pageNumber = '1';
                const pageMatch = url.match(/[?&]page=(\d+)/);
                if (pageMatch) {
                    pageNumber = pageMatch[1];
                }

                // Verify URL hasn't changed during processing
                if (url !== window.location.href) {
                    setTimeout(checkPage, 500);
                    return;
                }

                // Parse the profiles
                const profiles = JSON.parse(profilesDiv.textContent);

                resolve({
                    profiles: profiles.map(profile => ({
                        firstName: profile.user_first_name || '',
                        lastName: profile.user_last_name || '',
                        company: profile.user_company_name || '',
                        companyUrl: profile.user_company_id ?
                            `https://www.linkedin.com/company/${profile.user_company_id}` : null,
                        page: pageNumber
                    })),
                    currentUrl: url
                });
            } catch (e) {
                console.error('Error in findProfileData:', e);
                resolve(null);
            }
        };

        // Start checking
        checkPage();
    });
}

// Add this function to handle refresh
function refreshAndScrape(tabId) {
    chrome.tabs.reload(tabId, {}, function () {
        // Wait for page to load then scrape
        setTimeout(() => {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: findProfileData
            }, (results) => {
                // Handle results as before
            });
        }, 1000);  // Wait 1 second for page to load
    });
}

// Function to check if we need to refresh
function needsRefresh(currentUrl, lastUrl) {
    if (!lastUrl) return false;

    // Extract page numbers from both URLs
    const currentPageMatch = currentUrl.match(/[?&]page=(\d+)/);
    const lastPageMatch = lastUrl.match(/[?&]page=(\d+)/);

    const currentPage = currentPageMatch ? currentPageMatch[1] : '1';
    const lastPage = lastPageMatch ? lastPageMatch[1] : '1';

    // Return true if page numbers are different
    return currentPage !== lastPage;
}

// Function to execute scraping with retry logic
function executeScrapingWithRetry(tabId, currentTabUrl, retryCount = 0) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: findProfileData
    }, (results) => {
        if (results && results[0].result) {
            const result = results[0].result;

            // Store the URL we just scraped
            chrome.storage.local.set({ lastScrapedUrl: currentTabUrl });

            // Process the results
            const newProfiles = result.profiles;
            const currentPage = newProfiles[0]?.page || '1';

            chrome.storage.local.get(['linkedinData'], function (stored) {
                let existingProfiles = stored.linkedinData || [];

                // Remove profiles from the current page
                existingProfiles = existingProfiles.filter(profile => profile.page !== currentPage);

                // Add new profiles
                const mergedProfiles = [...existingProfiles, ...newProfiles];

                // Store updated data
                chrome.storage.local.set({
                    linkedinData: mergedProfiles
                }, () => {
                    // Clear loading state
                    dataList.innerHTML = '';

                    // Display profiles
                    displayProfiles(mergedProfiles);
                    updateProfileCount();
                });
            });
        } else if (retryCount < 3) {
            // Retry up to 3 times with increasing delays
            setTimeout(() => {
                executeScrapingWithRetry(tabId, currentTabUrl, retryCount + 1);
            }, (retryCount + 1) * 1000);
        } else {
            dataList.innerHTML = `
                <tr>
                    <td colspan="3">
                        Please refresh the page manually and try again.
                    </td>
                </tr>`;
            updateProfileCount();
        }
    });
}
