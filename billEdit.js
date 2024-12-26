
// Function to show the Edit Entry form
function showEditEntryForm() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('Enter Unique ID to Edit:');
  const uniqueId = response.getResponseText();

  if (uniqueId) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    // Find the row with the given Unique ID
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == uniqueId) {
        rowIndex = i;
        break;
      }
    }

    if (rowIndex != -1) {
      const rowData = data[rowIndex];
      let dateValue = rowData[2];

      // Check if dateValue is a date object and format it
      if (Object.prototype.toString.call(dateValue) === '[object Date]') {
        dateValue = Utilities.formatDate(dateValue, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        // Convert date format from yyyy/mm/dd to yyyy-mm-dd
        dateValue = dateValue.replace(/\//g, '-');
      }

      const formData = {
        uniqueId: uniqueId,
        description: rowData[1],
        date: dateValue,
        totalAmount: rowData[3],
        whoPaid: rowData[4],
        contributionSplit: rowData[5],
        balanceSplit: rowData[6],
        folderLink: rowData[7]
      };

      // Determine split type
      const splitType = formData.contributionSplit.includes('$') ? 'amount' : 'percentage';

      // Create HTML form with populated data
      const html = HtmlService.createTemplateFromFile('EditEntryForm');
      html.formData = JSON.stringify(formData);
      html.splitType = splitType;
      html.people = JSON.stringify(getPeople());  // Pass the people data to the template as JSON
      SpreadsheetApp.getUi().showModalDialog(
        html.evaluate().setWidth(400).setHeight(600),  // Show modal dialog with set dimensions
        'Edit Entry'  // Set title of the dialog
      );
    } else {
      ui.alert('Unique ID not found.');
    }
  }
}

// Submits the form data to Google Apps Script
function submitForm(event) {
  event.preventDefault(); // Prevent default form submission

  const submitButton = document.getElementById('submitButton');
  submitButton.disabled = true;
  submitButton.textContent = 'Processing...';
  submitButton.style.backgroundColor = '#ccc';

  const totalAmount = parseFloat(document.querySelector('[name="amount"]').value);
  let totalSplit = 0;
  let totalDollarAmount = 0;
  let isValid = true;

  // Collect member splits or amounts
  const members = [...document.querySelectorAll('.member')].map(member => {
    const splitValue = parseFloat(member.querySelector('input[type="number"]').value);
    const memberName = $(member).find('select').val();

    if (splitType === 'percentage') {
      totalSplit += splitValue; // Sum percentages
    } else if (splitType === 'amount') {
      totalDollarAmount += splitValue; // Sum dollar amounts
    }

    return {
      name: memberName,
      split: splitValue
    };
  });

  // Validate based on Split Type
  if (splitType === 'percentage' && totalSplit > 100) {
    alert('The total split percentage cannot exceed 100%.');
    isValid = false;
  } else if (splitType === 'amount' && totalDollarAmount > totalAmount) {
    alert('The total amount of splits cannot exceed the total amount.');
    isValid = false;
  }

  if (isValid) {
    const formData = {
      uniqueId: JSON.parse('<?= formData ?>').uniqueId,
      description: document.querySelector('[name="description"]').value,
      date: document.querySelector('[name="date"]').value,
      totalAmount: totalAmount,
      splitType: splitType,
      payers: [...document.querySelectorAll('.payer')].map(payer => ({
        name: $(payer).find('select').val(),
        payerAmount: parseFloat(payer.querySelector('input[type="number"]').value),
      })),
      members: members,
    };

    google.script.run
      .withSuccessHandler(() => {
        google.script.host.close();
      })
      .withFailureHandler(error => {
        alert('An error occurred: ' + error.message);
        submitButton.disabled = false;
        submitButton.textContent = 'Submit';
        submitButton.style.backgroundColor = '#1abc9c';
      })
      .updateBillInSheet(formData);
  } else {
    submitButton.disabled = false;
    submitButton.textContent = 'Submit';
    submitButton.style.backgroundColor = '#1abc9c';
  }
}

// Function to save edited entry
function saveEditedEntry(formData) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  
  // Find the row with the given Unique ID
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == formData.uniqueId) {
      rowIndex = i;
      break;
    }
  }
  
  if (rowIndex != -1) {
    // Update the row with new data
    sheet.getRange(rowIndex + 1, 2, 1, 6).setValues([[
      formData.description,
      formData.date,
      formData.totalAmount,
      formData.whoPaid,
      formData.contributionSplit,
      formData.balanceSplit
    ]]);
    SpreadsheetApp.getUi().alert('Entry updated successfully.');
  } else {
    SpreadsheetApp.getUi().alert('Unique ID not found.');
  }
}

function updateBillInSheet(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const { uniqueId, description, date, totalAmount, splitType, members, payers } = data;
  const dataRange = sheet.getDataRange().getValues();
  let rowIndex = -1;

  // Find the row with the given Unique ID
  for (let i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] == uniqueId) {
      rowIndex = i + 1; // Adjust for 1-based index
      break;
    }
  }

  if (rowIndex === -1) {
    SpreadsheetApp.getUi().alert('Unique ID not found.');
    return;
  }

  // Format the contribution split (percentage or amount)
  const contributionSplit = members.map(member => 
    splitType === 'percentage' ? `${member.name}: ${member.split}%` : `${member.name}: $${member.split}`
  ).join('\n');

  // Initialize and calculate balance split
  const balanceMap = new Map();
  members.forEach(member => {
    let contribution = member.split;
    if (splitType === 'percentage') {
      contribution = (totalAmount * member.split) / 100;
    }
    balanceMap.set(member.name, -contribution);
  });

  // Adjust balance for payers
  payers.forEach(payer => {
    const currentBalance = balanceMap.get(payer.name) || 0;
    balanceMap.set(payer.name, currentBalance + payer.payerAmount);
  });

  // Format the balance split
  const balanceSplit = Array.from(balanceMap.entries())
    .map(([name, balance]) => `${name}: ${balance >= 0 ? `+$${balance.toFixed(2)}` : `-$${Math.abs(balance).toFixed(2)}`}`)
    .join('\n');

  // Update the row with new data
  sheet.getRange(rowIndex, 2, 1, 6).setValues([[
    description,
    date,
    totalAmount,
    payers.map(p => `${p.name}: $${p.payerAmount}`).join('\n'),
    contributionSplit,
    balanceSplit
  ]]);

  // Update total amount and auto-resize columns
  updateTotalAmount();
  autoResizeColumnsD_F_G(sheet);
}