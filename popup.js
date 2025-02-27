// popup.js - Handles user interaction in the extension popup and displays the found names and companies
document.addEventListener('DOMContentLoaded', function () {
    const dataList = document.getElementById('dataList');
    const exportButton = document.getElementById('exportCsv');
    const clearButton = document.getElementById('clearData');

    // Load any existing data when popup opens
    loadStoredData();

    // Add clear button functionality
    clearButton.addEventListener('click', () => {
        // Clear the table
        dataList.innerHTML = '<tr><td colspan="3" class="empty-state">Click "Show LinkedIn Data" to view profiles</td></tr>';
        document.getElementById('profileCount').textContent = '0'; // Reset count when clearing

        // Clear the stored data
        chrome.storage.local.set({
            linkedinData: null
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

// Function to load stored data when popup opens
function loadStoredData() {
    chrome.storage.local.get(['linkedinData'], function (result) {
        if (result.linkedinData && result.linkedinData.length > 0) {
            displayProfiles(result.linkedinData, true);
        }
    });
}

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
        if (row.style.display !== 'none' &&
            !row.querySelector('.empty-state') &&
            !row.querySelector('.loading')) {
            count++;
        }
    }

    document.getElementById('profileCount').textContent = count;
}

// Function to create page navigation menu with hide/show toggle
function createPageNavigation(profiles) {
    // Get unique pages and sort them
    const pages = [...new Set(profiles.map(p => p.page))].sort((a, b) => parseInt(a) - parseInt(b));

    const navContainer = document.getElementById('page-nav');
    navContainer.innerHTML = '';

    // Create flex container for pages and toggle button
    const flexContainer = document.createElement('div');
    flexContainer.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 10px 0;
        gap: 16px;
    `;

    // Create pages container
    const pagesContainer = document.createElement('div');
    pagesContainer.style.cssText = `
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
    `;

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

        pagesContainer.appendChild(pageButton);
    });

    // Create toggle button
    const toggleButton = document.createElement('button');

    // Get the initial state from storage
    chrome.storage.local.get(['redRowsHidden'], function (result) {
        const redRowsHidden = result.redRowsHidden || false;
        toggleButton.textContent = redRowsHidden ? 'Show Red' : 'Hide Red';

        // Apply initial state
        const rows = dataList.getElementsByTagName('tr');
        for (let row of rows) {
            if (row.classList.contains('no-company-link')) {
                row.style.display = redRowsHidden ? 'none' : '';
            }
        }
        updateProfileCount();
    });

    toggleButton.style.cssText = `
        padding: 6px 12px;
        border: 1px solid #dc3545;
        background: white;
        color: #dc3545;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
        white-space: nowrap;
    `;

    toggleButton.addEventListener('click', () => {
        chrome.storage.local.get(['redRowsHidden'], function (result) {
            const newState = !(result.redRowsHidden || false);

            // Update storage
            chrome.storage.local.set({ redRowsHidden: newState }, () => {
                toggleButton.textContent = newState ? 'Show Red' : 'Hide Red';

                // Update visibility
                const rows = dataList.getElementsByTagName('tr');
                for (let row of rows) {
                    if (row.classList.contains('no-company-link')) {
                        row.style.display = newState ? 'none' : '';
                    }
                }

                // Update count of visible profiles
                updateProfileCount();
            });
        });
    });

    // Add hover effects for toggle button
    toggleButton.addEventListener('mouseover', () => {
        toggleButton.style.backgroundColor = '#dc3545';
        toggleButton.style.color = 'white';
    });

    toggleButton.addEventListener('mouseout', () => {
        toggleButton.style.backgroundColor = 'white';
        toggleButton.style.color = '#dc3545';
    });

    flexContainer.appendChild(pagesContainer);
    flexContainer.appendChild(toggleButton);
    navContainer.appendChild(flexContainer);
}

// Function to display profiles with sorting
function displayProfiles(profiles, isInitialLoad) {
    if (isInitialLoad) {
        dataList.innerHTML = '';
    }

    const sortedProfiles = profiles.sort((a, b) => {
        const pageA = parseInt(a.page) || 1;
        const pageB = parseInt(b.page) || 1;
        return pageA - pageB;
    });

    createPageNavigation(sortedProfiles);

    // Get both the visibility state and manually marked rows
    chrome.storage.local.get(['redRowsHidden', 'manuallyMarkedRows'], function (result) {
        const redRowsHidden = result.redRowsHidden || false;
        const manuallyMarkedRows = result.manuallyMarkedRows || {};

        sortedProfiles.forEach(profile => {
            const row = document.createElement('tr');
            const nameCell = document.createElement('td');
            const companyCell = document.createElement('td');
            const pageCell = document.createElement('td');

            nameCell.textContent = `${profile.firstName} ${profile.lastName}`.trim();

            // Create unique identifier for the row
            const rowId = `${profile.firstName}_${profile.lastName}_${profile.page}`;

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
                row.classList.add('no-company-link');
                nameCell.style.backgroundColor = '#ffebee';
                companyCell.style.backgroundColor = '#ffebee';
                pageCell.style.backgroundColor = '#ffebee';
            }

            // Check if this row was manually marked
            if (manuallyMarkedRows[rowId]) {
                row.classList.add('no-company-link');
                nameCell.style.backgroundColor = '#ffebee';
                companyCell.style.backgroundColor = '#ffebee';
                pageCell.style.backgroundColor = '#ffebee';
            }

            pageCell.textContent = `Page ${profile.page}`;
            pageCell.style.textAlign = 'center';

            // Add hover effect and double-click functionality
            row.style.transition = 'background-color 0.2s ease';
            row.style.cursor = 'pointer';

            row.addEventListener('dblclick', () => {
                chrome.storage.local.get(['manuallyMarkedRows'], function (data) {
                    const markedRows = data.manuallyMarkedRows || {};
                    const companyName = profile.company;

                    // Get all rows in the table
                    const allRows = dataList.getElementsByTagName('tr');

                    if (row.classList.contains('no-company-link')) {
                        // Remove red marking from all matching company rows
                        for (let r of allRows) {
                            const rCompany = r.cells[1].textContent;
                            const rName = r.cells[0].textContent;
                            const rPage = r.cells[2].textContent.replace('Page ', '');
                            const rId = `${rName.split(' ')[0]}_${rName.split(' ').slice(1).join(' ')}_${rPage}`;

                            if (rCompany === companyName) {
                                r.classList.remove('no-company-link');
                                r.cells[0].style.backgroundColor = '';
                                r.cells[1].style.backgroundColor = '';
                                r.cells[2].style.backgroundColor = '';
                                delete markedRows[rId];
                            }
                        }
                    } else {
                        // Add red marking to all matching company rows
                        for (let r of allRows) {
                            const rCompany = r.cells[1].textContent;
                            const rName = r.cells[0].textContent;
                            const rPage = r.cells[2].textContent.replace('Page ', '');
                            const rId = `${rName.split(' ')[0]}_${rName.split(' ').slice(1).join(' ')}_${rPage}`;

                            if (rCompany === companyName) {
                                r.classList.add('no-company-link');
                                r.cells[0].style.backgroundColor = '#ffebee';
                                r.cells[1].style.backgroundColor = '#ffebee';
                                r.cells[2].style.backgroundColor = '#ffebee';
                                markedRows[rId] = true;
                            }
                        }
                    }

                    // Update storage
                    chrome.storage.local.set({ manuallyMarkedRows: markedRows }, () => {
                        // Apply visibility if reds are currently hidden
                        if (redRowsHidden) {
                            for (let r of allRows) {
                                if (r.classList.contains('no-company-link')) {
                                    r.style.display = 'none';
                                }
                            }
                            updateProfileCount();
                        }
                    });
                });
            });

            // Add hover effect
            row.addEventListener('mouseover', () => {
                if (!row.classList.contains('no-company-link')) {
                    nameCell.style.backgroundColor = '#f5f5f5';
                    companyCell.style.backgroundColor = '#f5f5f5';
                    pageCell.style.backgroundColor = '#f5f5f5';
                }
            });

            row.addEventListener('mouseout', () => {
                if (!row.classList.contains('no-company-link')) {
                    nameCell.style.backgroundColor = '';
                    companyCell.style.backgroundColor = '';
                    pageCell.style.backgroundColor = '';
                }
            });

            row.appendChild(nameCell);
            row.appendChild(companyCell);
            row.appendChild(pageCell);

            // Apply visibility state
            if (row.classList.contains('no-company-link') && redRowsHidden) {
                row.style.display = 'none';
            }

            dataList.appendChild(row);
        });

        updateProfileCount();
    });
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