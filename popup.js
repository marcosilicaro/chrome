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
            const dataTable = document.querySelector('.searchResultsTable');

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
        const dataTable = document.querySelector('.searchResultsTable');

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

    // Add Show Red button functionality
    const showRedButton = document.getElementById('showRed');

    // Initialize button state
    let showingRed = false;

    showRedButton.addEventListener('click', () => {
        showingRed = !showingRed;
        // Select both no-company rows and manually reddened rows
        const redRows = document.querySelectorAll('.no-company-link, .manually-red');

        redRows.forEach(row => {
            row.style.display = showingRed ? '' : 'none';
        });

        showRedButton.textContent = showingRed ? 'Hide Red' : 'Show Red';
    });

    // Check page type when popup opens
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0].url;

        // Check for employee search page
        const isEmployeeSearchPage = currentUrl.startsWith('https://www.linkedin.com/sales/search') &&
            !currentUrl.includes('CURRENT_COMPANY');

        // Check for both company page and specific employee list view
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: () => {
                const hasEmployeeList = document.querySelector('._card-container_o3zzrt._container_iq15dg._lined_1aegh9') !== null;
                const hasAccountActions = document.querySelector('.account-actions._actions-container_ma5xyq._vertical-layout_ma5xyq._header--actions_1808vy') !== null;
                return {
                    isCompanyPage: window.location.href.includes('/sales/company/'),
                    isEmployeeList: hasEmployeeList,
                    hasAccountActions: hasAccountActions
                };
            }
        }, (results) => {
            if (results && results[0].result) {
                const { isCompanyPage, isEmployeeList, hasAccountActions } = results[0].result;

                // Handle employees table and its buttons visibility
                const employeesTable = document.getElementById('employeesTable');
                const employeeListButtons = document.getElementById('employeeListButtons');

                // Handle search results table and its buttons visibility
                const searchResultsTable = document.querySelector('.searchResultsTable');
                const searchContainer = document.querySelector('.search-container');
                const mainButtons = document.querySelector('.button-container');
                const pageNav = document.querySelector('#page-nav');
                const footer = document.querySelector('.footer');

                // Show/hide employees table based on employee list presence
                if (employeesTable) {
                    employeesTable.style.display = isEmployeeList ? 'block' : 'none';
                }
                if (employeeListButtons) {
                    employeeListButtons.style.display = isEmployeeList ? 'flex' : 'none';
                }

                // Show/hide search results based on URL and absence of special elements
                const shouldShowSearchResults = isEmployeeSearchPage && !isEmployeeList && !hasAccountActions;
                searchResultsTable.style.display = shouldShowSearchResults ? 'block' : 'none';
                searchContainer.style.display = shouldShowSearchResults ? 'block' : 'none';
                mainButtons.style.display = shouldShowSearchResults ? 'flex' : 'none';
                pageNav.style.display = shouldShowSearchResults ? 'block' : 'none';
                footer.style.display = shouldShowSearchResults ? 'block' : 'none';

                // Handle company table visibility
                const companiesTable = document.getElementById('companiesTable');
                companiesTable.style.display = isCompanyPage ? 'block' : 'none';
            }
        });
    });

    // Add employee list button functionality
    const showEmployeesBtn = document.getElementById('showEmployees');
    const clearEmployeesBtn = document.getElementById('clearEmployees');
    const showRedEmployeesBtn = document.getElementById('showRedEmployees');
    const employeesTableBody = document.getElementById('employeesTableBody');
    const loadingTemplate = document.getElementById('loading-template');

    // Show Employees button functionality
    showEmployeesBtn.addEventListener('click', () => {
        // Show loading state
        employeesTableBody.innerHTML = loadingTemplate.innerHTML;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            // Always refresh the page first
            chrome.tabs.reload(tabs[0].id, {}, function () {
                // Use polling to check if page is ready for scraping
                // Start with a small delay to ensure refresh has initiated
                setTimeout(() => {
                    checkPageReadyAndScrape(tabs[0].id);
                }, 1000); // Give the page 1 second to begin refreshing properly
            });
        });
    });

    // Function to poll the page until it's ready, then scrape
    function checkPageReadyAndScrape(tabId, attempts = 0) {
        // Limit the number of attempts to prevent infinite polling
        if (attempts > 20) { // 20 attempts = 10 seconds maximum wait
            employeesTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">Could not load employee data. Please try again.</td></tr>';
            return;
        }

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: isPageReady
        }, (results) => {
            if (results && results[0].result) {
                // Page is ready, proceed with scraping
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    function: findEmployeeDataWithPage
                }, (results) => {
                    if (results && results[0].result) {
                        const { employees: newEmployees, pageNumber } = results[0].result;

                        chrome.storage.local.get(['employeeData'], function (stored) {
                            let existingEmployees = stored.employeeData || [];

                            // Filter out employees from the current page if we're re-scraping it
                            const filteredEmployees = existingEmployees.filter(emp => emp.page !== pageNumber);

                            // Add page number to each new employee
                            const newEmployeesWithPage = newEmployees.map(emp => ({
                                ...emp,
                                page: pageNumber
                            }));

                            // Merge filtered existing employees with new ones
                            const mergedEmployees = [...filteredEmployees, ...newEmployeesWithPage];

                            chrome.storage.local.set({
                                employeeData: mergedEmployees
                            }, () => {
                                displayEmployees(mergedEmployees);
                            });
                        });
                    } else {
                        employeesTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">No employee data found. Please try again.</td></tr>';
                    }
                });
            } else {
                // Page is not ready yet, poll again after a short delay
                setTimeout(() => {
                    checkPageReadyAndScrape(tabId, attempts + 1);
                }, 500); // Check every 500ms
            }
        });
    }

    // Function to check if the page is ready for scraping
    function isPageReady() {
        try {
            // Check if the profiles element exists
            const profilesDiv = document.getElementById('findymail-profiles');
            if (!profilesDiv) return false;

            // Check if pagination is visible (if applicable)
            const paginationElement = document.querySelector('.artdeco-pagination');
            const hasPagination = paginationElement !== null;

            // If we have pagination, make sure the active page indicator is present
            if (hasPagination) {
                const activePageIndicator = document.querySelector('.artdeco-pagination__indicator.artdeco-pagination__indicator--number.active');
                if (!activePageIndicator) return false;
            }

            // Check if profile cards are loaded
            const profileCards = document.querySelectorAll('._card-container_o3zzrt');
            if (profileCards.length === 0) return false;

            // All checks passed, page is ready
            return true;
        } catch (e) {
            console.error('Error in isPageReady:', e);
            return false;
        }
    }

    // Clear Employees button functionality
    clearEmployeesBtn.addEventListener('click', () => {
        employeesTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">Click "Show Employees" to view employee list</td></tr>';
        chrome.storage.local.remove(['employeeData']);
    });

    // Show Red Employees button functionality
    let showingRedEmployees = false;
    showRedEmployeesBtn.addEventListener('click', () => {
        showingRedEmployees = !showingRedEmployees;
        const redRows = document.querySelectorAll('#employeesTableBody .no-title, #employeesTableBody .manually-red');

        redRows.forEach(row => {
            row.style.display = showingRedEmployees ? '' : 'none';
        });

        showRedEmployeesBtn.textContent = showingRedEmployees ? 'Hide Red' : 'Show Red';
    });

    // Updated function to find employee data from the page with page number
    function findEmployeeDataWithPage() {
        try {
            const employees = [];
            const profilesDiv = document.getElementById('findymail-profiles');

            // Get the current page number
            let pageNumber = '1';
            const paginationElement = document.querySelector('.artdeco-pagination__indicator.artdeco-pagination__indicator--number.active');
            if (paginationElement) {
                pageNumber = paginationElement.textContent.trim();
            }

            if (profilesDiv) {
                const profilesData = JSON.parse(profilesDiv.textContent);

                profilesData.forEach(profile => {
                    employees.push({
                        name: `${profile.user_first_name} ${profile.user_last_name}`.trim(),
                        position: profile.job_title || '-',
                        hasPosition: !!profile.job_title
                    });
                });
            }

            return {
                employees: employees,
                pageNumber: pageNumber
            };
        } catch (e) {
            console.error('Error in findEmployeeDataWithPage:', e);
            return {
                employees: [],
                pageNumber: '1'
            };
        }
    }

    // Function to display employees
    function displayEmployees(employees) {
        const employeesTableBody = document.getElementById('employeesTableBody');
        employeesTableBody.innerHTML = '';

        if (employees.length === 0) {
            employeesTableBody.innerHTML = `
                <tr>
                    <td colspan="3" class="empty-state">No employees found</td>
                </tr>`;
            return;
        }

        employees.forEach(employee => {
            const row = document.createElement('tr');

            row.innerHTML = `
                <td>${employee.name}</td>
                <td>${employee.position}</td>
                <td>
                    <input type="checkbox" class="employee-checkbox" style="cursor: pointer;">
                </td>
            `;

            employeesTableBody.appendChild(row);
        });
    }

    // Load stored employees when popup opens
    chrome.storage.local.get(['employeeData'], function (result) {
        if (result.employeeData && result.employeeData.length > 0) {
            displayEmployees(result.employeeData);
        }
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
    const dataList = document.getElementById('dataList');
    dataList.innerHTML = '';

    const sortedProfiles = [...profiles].sort((a, b) => {
        const nameA = `${a.firstName} ${a.lastName}`.toLowerCase();
        const nameB = `${b.firstName} ${b.lastName}`.toLowerCase();
        return nameA.localeCompare(nameB);
    });

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

        // Modified double-click handler to toggle red color
        row.addEventListener('dblclick', () => {
            const isRed = row.classList.contains('manually-red');
            if (isRed) {
                // Remove red background
                nameCell.style.backgroundColor = '';
                companyCell.style.backgroundColor = '';
                pageCell.style.backgroundColor = '';
                row.classList.remove('manually-red');
                row.style.display = ''; // Always show when removing red
            } else {
                // Add red background
                nameCell.style.backgroundColor = '#ffebee';
                companyCell.style.backgroundColor = '#ffebee';
                pageCell.style.backgroundColor = '#ffebee';
                row.classList.add('manually-red');

                // Hide the row if "Show Red" is currently set to hide
                const showRedButton = document.getElementById('showRed');
                if (showRedButton.textContent === 'Show Red') {
                    row.style.display = 'none';
                }
            }
        });

        if (profile.company && profile.companyUrl) {
            const companyLink = document.createElement('a');
            companyLink.href = profile.companyUrl;
            companyLink.textContent = profile.company;
            companyLink.target = '_blank';
            companyLink.style.color = '#0077b5';
            companyLink.style.textDecoration = 'none';

            // Check for previously clicked links
            chrome.storage.local.get(['clickedLinks'], (result) => {
                const clickedLinks = result.clickedLinks || [];
                if (clickedLinks.includes(profile.companyUrl)) {
                    row.style.backgroundColor = '#e8f4f9';
                }
            });

            companyLink.addEventListener('click', (e) => {
                e.preventDefault();
                const rowElement = e.target.closest('tr');
                if (rowElement) {
                    rowElement.style.backgroundColor = '#e8f4f9';

                    chrome.storage.local.get(['clickedLinks'], (result) => {
                        const clickedLinks = result.clickedLinks || [];
                        if (!clickedLinks.includes(profile.companyUrl)) {
                            clickedLinks.push(profile.companyUrl);
                            chrome.storage.local.set({ clickedLinks: clickedLinks });
                        }
                    });
                }

                chrome.tabs.create({
                    url: companyLink.href,
                    active: false
                });
            });

            companyCell.appendChild(companyLink);
        } else {
            companyCell.textContent = profile.company || '-';
            row.classList.add('no-company-link');
            nameCell.style.backgroundColor = '#ffebee';
            companyCell.style.backgroundColor = '#ffebee';
            pageCell.style.backgroundColor = '#ffebee';
            row.style.display = 'none'; // Initially hidden
        }

        row.appendChild(nameCell);
        row.appendChild(companyCell);
        row.appendChild(pageCell);
        dataList.appendChild(row);
    });

    // Reset Show Red button text when displaying new profiles
    const showRedButton = document.getElementById('showRed');
    if (showRedButton) {
        showRedButton.textContent = 'Show Red';
    }

    // ... rest of existing code ...
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

    // Load saved companies and check if current company is saved
    loadSavedCompanies();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0].url;

        // Check for both company page and specific employee list view
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: () => {
                const isEmployeeList = document.querySelector('._card-container_o3zzrt._container_iq15dg._lined_1aegh9') !== null;
                return {
                    isCompanyPage: window.location.href.includes('/sales/company/'),
                    isEmployeeList: isEmployeeList
                };
            }
        }, (results) => {
            if (results && results[0].result) {
                const { isCompanyPage, isEmployeeList } = results[0].result;

                // Handle company table visibility
                companiesTable.style.display = isCompanyPage ? 'block' : 'none';

                // Handle employees table visibility
                const employeesTable = document.getElementById('employeesTable');
                if (employeesTable) {
                    employeesTable.style.display = isEmployeeList ? 'block' : 'none';
                }

                if (isCompanyPage) {
                    chrome.storage.local.get(['savedCompanies'], function (result) {
                        const companies = result.savedCompanies || [];
                        const currentCompanyName = document.querySelector('.company-name').textContent;
                        const isCompanySaved = companies.some(c => c.name === currentCompanyName);
                        updateAddButton(addCompanyBtn, isCompanySaved);
                    });
                }
            }
        });
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