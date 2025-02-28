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

    // Add function to check if current URL is a company page
    function checkIfCompanyPage(url) {
        return url.includes('/company/') || url.includes('/sales/company/');
    }

    // Function to update button style based on page type
    function updateButtonStyle(url) {
        if (checkIfCompanyPage(url)) {
            exportButton.classList.add('company-page');
        } else {
            exportButton.classList.remove('company-page');
        }
    }

    // Check URL when popup opens
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        updateButtonStyle(tabs[0].url);
    });

    // Update the export button click handler
    exportButton.addEventListener('click', () => {
        // Show loading state
        const loadingTemplate = document.getElementById('loading-template');
        dataList.innerHTML = loadingTemplate.innerHTML;

        // Query for the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTabUrl = tabs[0].url;
            const isCompanyPage = checkIfCompanyPage(currentTabUrl);
            const companyInfo = document.getElementById('companyInfo');
            const dataTable = document.querySelector('.data-table');

            if (isCompanyPage) {
                // Show company info and hide all search/table related elements
                companyInfo.style.display = 'block';
                dataTable.style.display = 'none';
                document.querySelector('.search-container').style.display = 'none';
                document.querySelector('#page-nav').style.display = 'none';
                document.querySelector('.footer').style.display = 'none';
                document.querySelector('.button-container').style.display = 'none';

                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    function: findCompanyData
                }, (results) => {
                    if (results && results[0].result) {
                        const company = results[0].result;
                        companyInfo.querySelector('.company-name').textContent = company.name;
                        companyInfo.querySelector('.company-description').textContent = company.description;
                        companyInfo.querySelector('.company-location').textContent = `Location: ${company.location}`;

                        // Update metrics display in a clean format
                        const metricsHtml = `
                            <p><strong>All Employees:</strong> ${company.metrics.allEmployees.count}</p>
                            <p><strong>South America:</strong> ${company.metrics.southAmerica.count}</p>
                            <p><strong>Philippines:</strong> ${company.metrics.philippines}</p>
                            <p><strong>HHRR:</strong> ${company.metrics.hhrr}</p>
                            <p><strong>Decision Makers:</strong> ${company.metrics.decisionMakers.count}</p>
                        `;
                        companyInfo.querySelector('.company-details').innerHTML = metricsHtml;
                    }
                });
            } else {
                // Show all search/table related elements and hide company info
                companyInfo.style.display = 'none';
                dataTable.style.display = 'block';
                document.querySelector('.search-container').style.display = 'block';
                document.querySelector('#page-nav').style.display = 'block';
                document.querySelector('.footer').style.display = 'block';
                document.querySelector('.button-container').style.display = 'block';

                // Execute normal profile scraping
                chrome.storage.local.get(['lastScrapedUrl'], function (result) {
                    if (needsRefresh(currentTabUrl, result.lastScrapedUrl)) {
                        chrome.tabs.reload(tabs[0].id, {}, function () {
                            setTimeout(() => {
                                executeScrapingWithRetry(tabs[0].id, currentTabUrl);
                            }, 1000);
                        });
                    } else {
                        executeScrapingWithRetry(tabs[0].id, currentTabUrl);
                    }
                });
            }
        });
    });

    // When popup opens, check if we're on a company page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const isCompanyPage = checkIfCompanyPage(tabs[0].url);
        const companyInfo = document.getElementById('companyInfo');
        const dataTable = document.querySelector('.data-table');

        if (isCompanyPage) {
            companyInfo.style.display = 'block';
            dataTable.style.display = 'none';
            // Trigger the button click to load company data
            exportButton.click();
            document.getElementById('addCompany').style.display = 'block';
            document.getElementById('showCompanies').style.display = 'block';
        } else {
            companyInfo.style.display = 'none';
            dataTable.style.display = 'block';
            // Load stored profile data
            loadStoredData();
            document.getElementById('addCompany').style.display = 'none';
            document.getElementById('showCompanies').style.display = 'none';
        }
    });

    initializeCompanyFeatures();
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
            row.style.transition = 'background-color 0.2s';
            row.style.cursor = 'pointer';

            const nameCell = document.createElement('td');
            const companyCell = document.createElement('td');
            const pageCell = document.createElement('td');

            nameCell.textContent = `${profile.firstName} ${profile.lastName}`.trim();
            pageCell.textContent = `Page ${profile.page}`;
            pageCell.style.textAlign = 'center';

            if (profile.company && profile.companyUrl) {
                const companyLink = document.createElement('a');
                companyLink.href = profile.companyUrl;
                companyLink.textContent = profile.company;
                companyLink.target = '_blank';
                companyLink.style.color = '#0077b5';
                companyLink.style.textDecoration = 'none';

                // Modified click handler to keep popup open
                companyLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    const rowElement = e.target.closest('tr');
                    if (rowElement) {
                        rowElement.style.backgroundColor = '#e8f4f9';
                    }

                    // Use chrome.tabs.create to open the link instead of window.open
                    chrome.tabs.create({
                        url: companyLink.href,
                        active: false  // This keeps the popup in focus
                    });
                });

                companyCell.appendChild(companyLink);
            } else {
                companyCell.textContent = profile.company || '-';
                row.classList.add('no-company-link');
            }

            // Check if this row was manually marked
            if (manuallyMarkedRows[`${profile.firstName}_${profile.lastName}_${profile.page}`]) {
                row.classList.add('no-company-link');
                nameCell.style.backgroundColor = '#ffebee';
                companyCell.style.backgroundColor = '#ffebee';
                pageCell.style.backgroundColor = '#ffebee';
            }

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
        const checkPage = () => {
            const profilesDiv = document.getElementById('findymail-profiles');
            const url = window.location.href;

            if (!profilesDiv) {
                setTimeout(checkPage, 500);
                return;
            }

            try {
                let pageNumber = '1';
                const pageMatch = url.match(/[?&]page=(\d+)/);
                if (pageMatch) {
                    pageNumber = pageMatch[1];
                }

                if (url !== window.location.href) {
                    setTimeout(checkPage, 500);
                    return;
                }

                const profiles = JSON.parse(profilesDiv.textContent);

                resolve({
                    profiles: profiles.map(profile => ({
                        firstName: profile.user_first_name || '',
                        lastName: profile.user_last_name || '',
                        company: profile.user_company_name || '',
                        companyUrl: profile.user_company_id ?
                            `https://www.linkedin.com/sales/company/${profile.user_company_id}` : null,  // Add full domain
                        page: pageNumber
                    })),
                    currentUrl: url
                });
            } catch (e) {
                console.error('Error in findProfileData:', e);
                resolve(null);
            }
        };

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

// Function to find company data
function findCompanyData() {
    return new Promise((resolve) => {
        try {
            const companyName = document.querySelector('[data-anonymize="company-name"]')?.textContent?.trim() || '';
            const industry = document.querySelector('[data-anonymize="industry"]')?.textContent?.trim() || '';
            const location = document.querySelector('[data-anonymize="location"]')?.textContent?.trim() || '';

            const metrics = {
                allEmployees: { count: '0', link: '' },
                southAmerica: { count: '0', link: '' },
                decisionMakers: { count: '0', link: '' }
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
            });

            resolve({
                name: companyName,
                description: `${industry} company`,
                location: location,
                metrics: metrics
            });
        } catch (e) {
            console.error('Error in findCompanyData:', e);
            resolve({
                name: 'Error retrieving company data',
                description: '',
                location: '',
                metrics: {
                    allEmployees: { count: '0', link: '' },
                    southAmerica: { count: '0', link: '' },
                    decisionMakers: { count: '0', link: '' }
                }
            });
        }
    });
}

function initializeCompanyFeatures() {
    const addCompanyBtn = document.getElementById('addCompany');
    const showCompaniesBtn = document.getElementById('showCompanies');
    const hideCompaniesBtn = document.getElementById('hideCompanies');
    const companiesTable = document.getElementById('companiesTable');
    const clearAllBtn = document.getElementById('clearAllCompanies');

    // Show companies table by default
    companiesTable.style.display = 'block';

    // Load saved companies and check if current company is saved
    loadSavedCompanies();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0].url;
        if (currentUrl.includes('/sales/company/')) {
            chrome.storage.local.get(['savedCompanies'], function (result) {
                const companies = result.savedCompanies || [];
                const currentCompanyName = document.querySelector('.company-name').textContent;
                const isCompanySaved = companies.some(c => c.name === currentCompanyName);

                updateAddButton(addCompanyBtn, isCompanySaved);
            });
        }
    });

    addCompanyBtn.addEventListener('click', () => {
        if (addCompanyBtn.classList.contains('remove-company')) {
            // Remove company functionality
            chrome.storage.local.get(['savedCompanies'], function (result) {
                const companies = result.savedCompanies || [];
                const currentCompanyName = document.querySelector('.company-name').textContent;
                const updatedCompanies = companies.filter(c => c.name !== currentCompanyName);

                chrome.storage.local.set({ savedCompanies: updatedCompanies }, () => {
                    updateCompaniesTable();
                    updateAddButton(addCompanyBtn, false);
                });
            });
        } else {
            // Add company functionality
            addCompany();
        }
    });

    showCompaniesBtn.addEventListener('click', () => {
        companiesTable.style.display = 'block';
        showCompaniesBtn.style.display = 'none';
        hideCompaniesBtn.style.display = 'block';
    });

    hideCompaniesBtn.addEventListener('click', () => {
        companiesTable.style.display = 'none';
        hideCompaniesBtn.style.display = 'none';
        showCompaniesBtn.style.display = 'block';
    });

    clearAllBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all saved companies?')) {
            chrome.storage.local.set({ savedCompanies: [] }, () => {
                updateCompaniesTable();
                updateAddButton(addCompanyBtn, false);
            });
        }
    });

    // Initial button visibility
    if (companiesTable.style.display === 'none') {
        showCompaniesBtn.style.display = 'block';
        hideCompaniesBtn.style.display = 'none';
    } else {
        showCompaniesBtn.style.display = 'none';
        hideCompaniesBtn.style.display = 'block';
    }
}

// Add this function to ensure companies are loaded on popup open
function loadSavedCompanies() {
    chrome.storage.local.get(['savedCompanies'], function (result) {
        if (result.savedCompanies) {
            updateCompaniesTable();
        }
    });
}

// Make sure we initialize features when the popup opens
document.addEventListener('DOMContentLoaded', function () {
    initializeCompanyFeatures();
});

function updateAddButton(button, isCompanySaved) {
    if (isCompanySaved) {
        button.textContent = 'Remove Company';
        button.classList.add('remove-company');
        button.style.backgroundColor = '#dc3545';
    } else {
        button.textContent = 'Add Company';
        button.classList.remove('remove-company');
        button.style.backgroundColor = '#0073b1';
    }
}

function addCompany() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0].url;

        const companyInfo = {
            name: document.querySelector('.company-name').textContent,
            url: currentUrl,
            allEmployees: { count: '0', link: '' },
            southAmerica: { count: '0', link: '' },
            decisionMakers: { count: '0', link: '' }
        };

        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: findCompanyData
        }, (results) => {
            if (results && results[0].result) {
                const data = results[0].result;
                companyInfo.allEmployees = data.metrics.allEmployees;
                companyInfo.southAmerica = data.metrics.southAmerica;
                companyInfo.decisionMakers = data.metrics.decisionMakers;

                chrome.storage.local.get(['savedCompanies'], function (result) {
                    const companies = result.savedCompanies || [];
                    if (!companies.some(c => c.name === companyInfo.name)) {
                        companies.push(companyInfo);
                        chrome.storage.local.set({ savedCompanies: companies }, () => {
                            updateCompaniesTable();
                            const addCompanyBtn = document.getElementById('addCompany');
                            updateAddButton(addCompanyBtn, true);
                        });
                    }
                });
            }
        });
    });
}

function updateCompaniesTable() {
    const tableBody = document.getElementById('companiesTableBody');

    chrome.storage.local.get(['savedCompanies'], function (result) {
        const companies = result.savedCompanies || [];
        tableBody.innerHTML = '';

        companies.forEach((company, index) => {
            const row = document.createElement('tr');

            const createMetricCell = (metric) => {
                return metric.link ?
                    `<a href="${metric.link}" class="metric-link" target="_blank" rel="noopener noreferrer">
                        ${metric.count}
                     </a>` :
                    metric.count;
            };

            row.innerHTML = `
                <td>
                    <a href="${company.url}" target="_blank" rel="noopener noreferrer">
                        ${company.name}
                    </a>
                </td>
                <td>${createMetricCell(company.allEmployees)}</td>
                <td>${createMetricCell(company.southAmerica)}</td>
                <td>${createMetricCell(company.decisionMakers)}</td>
                <td>
                    <button class="delete-btn" data-index="${index}" title="Remove company">×</button>
                </td>
            `;
            tableBody.appendChild(row);
        });

        // Add remove button listeners
        document.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                removeCompany(index);
            });
        });
    });
}

function removeCompany(index) {
    chrome.storage.local.get(['savedCompanies'], function (result) {
        const companies = result.savedCompanies || [];
        companies.splice(index, 1);
        chrome.storage.local.set({ savedCompanies: companies }, () => {
            updateCompaniesTable();
        });
    });
}