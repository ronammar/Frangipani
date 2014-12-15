/*
 * Frangipani app Javascript.
 * @author Ron Ammar
 * @patrick Magee
 */




/*
 * Global Settings and global values
 */


/* A variable to contain all of the currnet information on
 * which patient is being accessed, which project is being
 * used etc instead of coding the information within the html
 * footer of the page. All functions add to this
 */
var settings = {
	//Side Bar data including status and html
	'sideBar': {
		'projectSideBarState': true,
		'previousHtml': undefined,
		'originalText': undefined
		},

	//triggers and data
	'buttonClicked': false,
	'applicationDataPreviousState': undefined,
	'applicationMain': undefined,
	'patientTable': undefined,
	'scrolledToBottom': true,
	'progressSpinner': undefined,
	'currentData': undefined
}



/* 
 * Auxiliary helper functions:
 */

/* Function to retrieve and render a handlebars template. This function is
 * modified from the function provided by user koorchik on StackOverFlow:
 * http://stackoverflow.com/questions/8366733/external-template-in-underscore
 * as explained on the following blog entry:
 * http://javascriptissexy.com/handlebars-js-tutorial-learn-everything-about-handlebars-js-javascript-templating/
 *
 * NOTE: In the future, I would compile all my templates into a single
 * templates.js file and load that in the beginning rather than have many
 * small synchronous AJAX calls to get templates when the webpage loads.
 */

var renderHbs= function(template_name, template_data) {
	if (!renderHbs.template_cache) { 
	    renderHbs.template_cache= {};
	}

	if (!renderHbs.template_cache[template_name]) {
		var template_url= '/templates/' + template_name;
		$.ajax({
			url: template_url,
			method: 'GET',
			async: false,  // I'm keeping this async for now (from original code) - but I really don't like it
			success: function(data) {
				renderHbs.template_cache[template_name]= Handlebars.compile(data);
			}
		});
	}

	return renderHbs.template_cache[template_name](template_data);
};



/* AJAX call to application server to retrieve projects. */
var getProjects= function() {
	settings.currentData = undefined;

	var promise= Promise.resolve($.ajax({
		url: "/datasets",  // Need the "http://" here or will get CORS error
		type: "GET",
		contentType: "application/json",
	}));

	return promise.then( function(result) {
		updateProjectTable(result);
	});
};

/* Get patients from this project. Project details are passed in via
 * options object keyed by "thisButton".
 * @return {Object} A promise describing state of request. */
var getProjectPatients= function(options) {
	// Find out if this is a new table or rows to be appended to existing table
	if (settings.currentData === undefined){
		settings.currentData = {};
	}
	if (settings.currentData.pageToken === undefined){
		var projectButton = options["thisButton"];
		settings.currentData = {
			"variantSetIds": [projectButton.data("id")],
			"projectName": projectButton.data('project'),
			"pageToken": undefined
		};
		var currentTemplate= "frangipani-project-details.hbs";
		var domInsertPoint= settings.patientTable;
		resetPatientTable();
	} else {
		console.log("in here");
		currentTemplate= "frangipani-more-patients.hbs";
		domInsertPoint= settings.patientTable.find("tbody");
	}

	//Promise Function
	var promise= Promise.resolve($.ajax({
		url: "/callsets/search",
		type: "POST",
		contentType: "application/json",
		dataType: "json",
		data: JSON.stringify({
			"variantSetIds": settings.currentData.variantSetIds,
			"pageSize": 30,
			"pageToken": settings.currentData.pageToken
		})
	}));

	promise.then(function(result) {
		settings.currentData['pageToken'] = result['nextPageToken'];
		var context= {
			"callSets": result["callSets"],
			"projectName": settings.currentData.projectName,
		}

		var html= renderHbs(currentTemplate, context);
		domInsertPoint.append(html);


		//Add Click event handlers to new rendered html
		$('.frangipani-patient-link').on('click',getPatientVariantQuery);
		$('.frangipani-back-button').off('click');
		$(".frangipani-back-button").on('click',function(event){
				event.preventDefault();
				settings.currentData = undefined;
				settings.patientTable.empty();
				toggleProjectsSideBar();
				$(window).off('scroll.table');
			});

		// update the progress spinner's next page token, if the spinner already exists
		settings.progressSpinner.data("next-page", context["nextPageToken"]);
	
		return context;

	}).then(function(context) {
		// set scrolledToBottom to false, to allow for AJAX request triggers
		// on scroll events only after the table has been appended. If there
		// are no more page tokens, we have reached the bottom.
		refresh();
		if (settings.currentData.pageToken !== undefined) {
			settings.scrolledToBottom= false;
		}
		settings.progressSpinner.hide();
	});

	return promise;
};

/* construct an ajax call to the google server to retrive variant information
 * based on passed in information or informatiuon contained in the page footer.
* If there are more patients, load them when scrolled to the bottom of the
 * patient table. */


var getVariantCallSet = function(options){
		var varSet = settings.currentData.variants;
		//new search
		if (varSet['pageToken']===undefined){
			var dataToAdd = varSet;
			var template = "frangipani-variant-table.hbs";
			var domInsertPoint = $('#tableContents');

		//adding on to previous table
		} else {
			var template = "frangipani-more-variants-table.hbs";
			var domInsertPoint = $('#tableContents').find("tbody");
			var dataToAdd = varSet;
		}

		//promise function takes in previously parsed dataToAdd
		promise = Promise.resolve($.ajax({
			url: "/variants/search",
			type: "POST",
			contentType: "application/json",
			dataType: "json",
			data: JSON.stringify(dataToAdd)
		    }));

		promise.then(function(results){
			globalResults = results;	
			//Searcgh through results variants and determine
			//zygosity and genotype to add to the table
			var variants = results['variants'];
			for (var i=0; i < variants.length; i++){
				if (variants[i]['referenceBases'].length > 10 || variants[i]['alternateBases'].length > 10){
					variants[i] = undefined;
				} else {
					variants[i]['phase'] = variants[i].calls[0].phaseset;
					var genotypeArray = variants[i].calls[0].genotype;
					var zygosity = 0;
					var genotype = [];
					for (var j = 0; j < genotypeArray.length; j++){
						if (genotypeArray[j] === 0){
							genotype.push(variants[i]['referenceBases']);
						} else {
							zygosity += 1;
							genotype.push(variants[i]['alternateBases'][genotypeArray[j]-1]);
						}
					}
					genotype = genotype.join('/');
					if (zygosity === 0){
						zygosity = 'homo_ref';
					} else  if (zygosity === 1){
						zygosity = 'hetero';
					} else {
						zygosity = 'homo_alt';
					}
					variants[i]['zygosity'] = zygosity;
					variants[i]['genotypeCall'] = genotype;
				}
			};


			results['patientName'] = settings.currentData.patientName
			results['referenceName'] = dataToAdd['referenceName'];
			results['start'] = dataToAdd['start'];
			results['end'] = dataToAdd['end'];
			//render HTML onto the page populating the table
			var html = renderHbs(template,results);	
			domInsertPoint.append(html);
			//add in evenet listeners to rs numbers here
			varSet['pageToken'] = results['nextPageToken'];
			return results;
		}).then(function(result) {
		// set scrolledToBottom to false, to allow for AJAX request triggers
		// on scroll events only after the table has been appended. If there
		// are no more page tokens, we have reached the bottom.
			refresh();
			settings.buttonClicked = false;
			if (result["nextPageToken"] !== undefined) {
				settings.scrolledToBottom= false;	
			}
				settings.progressSpinner.hide();	
		});

		return promise;
};


/* Code snippet taken from jqeury github page for reliablly scrolling
 * to top or bottom of body when it is called. This function runs once. */
var unbindScroll = function(){
	$(window).off('scroll.table');
}

var scrolltoTop = function(){

	$.Deferred(function( defer ) {
    	$( "html, body" ).animate({
        // scroll to end of page
        	scrollTop: 0,
        	scrollLeft: 0,
        },'fast', defer.resolve );
		}).done(function() {
    	});
}


/* Clear the main application div. */
var clearApplicationMain= function() {
	// Scroll to the top of the page using animation
	//$("body").animate({scrollTop: 0, scrollLeft: 0}, "fast");
	scrolltoTop();
	settings.currentData = undefined;
	settings.applicationMain.children().remove();
};

/* Reset the patient table. */
var resetPatientTable= function() {
	// Scroll to the top of the page using animation, and set scrolledToBottom
	// as true to block AJAX request triggers on scroll events until we're at the top
	settings.scrolledToBottom= true;
	scrolltoTop();

	
	// Clear patient table
	settings.patientTable.children().remove();
};


//adds a class to a div
var toggleClassOnDiv = function(component,classIdentifier){
	component.toggleClass(classIdentifier);
};

/* Update the table of projects. */
var updateProjectTable= function(context) {
	clearApplicationMain();
	if (!settings.sideBar.projectSideBarState){
		settings.sideBar.projectSideBarState = true
		toggleClassOnDiv($('.frangipani-project-details'),'large-12');
	}
	// sort datasets in case-insensitive manner by name key
	var compare= function (d1, d2) {
		var a= d1.name.toUpperCase();
		var b= d2.name.toUpperCase();
		if (a < b)
			return -1;
		if (a > b)
			return 1;
		return 0;
	};
	context.datasets= context.datasets.sort(compare);


	var html= renderHbs('frangipani-projects.hbs', context);
	settings.applicationMain.append(html);

	// Add event listeners and refresh jQuery DOM objects.
	addProjectEventListeners();
	refresh();
};


/*
 * Event listeners
 */

/* When a button is clicked, calls a function. While the function is 
 * executing, button displays some intermediate text. Upon completion, button
 * reverts to original text. */
var clickAction= function(button, promiseFunction, options, useThis) {
	var originalText;

	var resetButton= function(val) {
		button.text(originalText);
		settings.buttonClicked = false
	};

	button.on("click", function(event) {
		event.preventDefault();
		if (!settings.buttonClicked){
			settings.buttonClicked=true
			if (useThis === true) {
				button= $(this);
				options["thisButton"]= $(this);
			}

			originalText= button.text();
			button.text("Fetching...");

			if (options === undefined) {
				promiseFunction().then(resetButton).then();
			} else {
				promiseFunction(options).then(resetButton);
			}
		}
	});
};



/* When triggered this button will toggle the side projects bar
 * Hiding it and increasing the main div size to 12 columns.
 * Its behaviour is controlled by a global variable: ProjectBarState
 * Which several functions (including the Browse function) set back
 * to true when activated.
*/

//var projectSideBar = $(".frangipani-available-projects");
var toggleProjectsSideBar = function(){
	if (settings.sideBar.projectSideBarState === true){	
		//save the contents of the div
		settings.previousHtml = $('#frangipani-title-description').html()
		$('#frangipani-title-description').empty().append('<a href="#" class="button"><i class="fi-arrow-left"> Back</i></a>').find('a')
		.addClass('frangipani-back-button');
		$('.frangipani-available-projects').toggle('slide');
		$('#frangipani-project-details').addClass('large-12');

		settings.sideBar.projectSideBarState = false;
	} else {
		//remove the button and repopulate with the previously saved html
		$('#frangipani-title-description').empty().append(settings.previousHtml);
		$('#frangipani-project-details').removeClass('large-12')	
		$('.frangipani-available-projects').toggle('slide');

		//reset the state
		settings.sideBar.projectSideBarState = true;
	}
};

/* Main Function for handling Variant searches and queries.
 * Starts by loading a form into the browswer into the patientDetails
 * div. When data is inputted and then submitted the a request is sent
 * to the google server to retrieve variant information. it is then
 * displayed in the browser
*/
var getPatientVariantQuery = function(options){
	$(window).off('scroll.table');
	var varSet = settings.currentData.variants = {};		
	var button = this.dataset;
	settings.currentData['patientName'] = button['patientName'];
	varSet['callSetIds'] = [button['patientId']];
	varSet['variantSetIds'] = settings.currentData.variantSetIds;

	var context = { 'patientName': settings.currentData['patientName'],
					'callSetIds': varSet['callSetIds'],
					'variantSetIds': varSet['variantSetIds']
	};
	var html = renderHbs("frangipani-request-variants.hbs",context);	

	//empty the current contents of the patientTable Div and append the search html
	settings.applicationDataPreviousState = settings.patientTable.html()	
	settings.patientTable.empty();
	settings.patientTable.append(html);

	//refresh the progressSpinner, this will be used later
	refresh();
	settings.progressSpinner.hide();
	settings.scrolledToBottom = false;

	// field data validation. eventually to be replaced
	// by data validation within the html itself
	var validate = function(){

		//var validObjects = new Object();
		var start = +$('#start-position').val();
		var end = +$('#end-position').val();
		var referenceName = $('#reference-name').val();
		var pageSize = $('#variants-per-page').val();
		var returnState = true

		if (pageSize <= 0){
			returnState = false;
		}
		if (referenceName.length === 0){
			returnState = false;
		}
		if(start !== undefined && end === undefined ||
			end !== undefined && start === undefined){
			returnState = false;
		}
		if(start > end){
			returnState = false;
		}
		if (start === 0 && end === 0){
			start = undefined;
			end = undefined;
		}

		if (returnState){
			varSet['pageSize'] = pageSize;
			varSet['referenceName'] = referenceName;
			varSet['start'] = start;
			varSet['end'] = end;
		}

		return returnState;
	};

	var resetSearchFields = function(){
		$('.variant-query-fields').slideDown().find("input").val("");
		$('#variants-per-page').val(30);

	}

	//add information to the back button event handler
	$('.frangipani-back-button').data({'id':varSet['variantSetIds'][0],'project':settings.currentData['projectName']}).data()
	$('.frangipani-back-button').off('click');
	$('.frangipani-back-button').on('click',function(event){
		if (!settings.buttonClicked){
			$(window).off('scroll.table')
			buttonClicked = true;
			varSet = undefined;
			settings.currentData['pageToken'] = undefined;
			event.preventDefault();
			var options = {'thisButton':$(this)};
			getProjectPatients(options).then(function(){
				settings.buttonClicked = false;
				settings.scrolledToBottom = false;
				refresh()
				loadPatientsOnScroll(getProjectPatients,'project');
			});
		}
	});

	/*  when the new search button is clicked it will cause
     *  the Search box to drop dowm. the new search button
     * itself is hid
     */
	$('#frangipani-new-search').on('click',function(event){
		event.preventDefault();
		if(!settings.buttonClicked){
			$(this).toggle();
			resetSearchFields();
		}
	});

	//Fill the input fields with example data
	$("#frangipangi-query-field-example").on('click',function(event){
		event.preventDefault();
		$('#start-position').val('41200000');
		$('#end-position').val('412800000');
		$('#reference-name').val('17');
	});

	//Cancel the search. Cannot be used when a button is already clicked.
	$('#frangipani-cancel-variant-request').on('click',function(event){
		event.preventDefault();
		$('.variant-query-fields').slideUp().parent().find('#frangipani-new-search').slideDown();
		settings.buttonClicked = false;
	});


	/* When this button is clicked a the data from the form is first
	 * Parsed and then validated. A query is then sent to retrieve
	 * variant information for the specified individual. Succesful searches
	 * populate a table
	 */
	$('#frangipani-submit-variant-request').on('click', function(event){
		var varSet = settings.currentData.variants;

		if (!settings.buttonClicked){
			settings.buttonClicked = true;
			event.preventDefault();
			var searchObjects = validate();
			if (searchObjects){
				//hide the search tab and add a spinner to the new search button while data is loading
				$('.variant-query-fields').slideUp().parent().find('#frangipani-new-search')
				.text("")
				.append('<i class="fa fa-refresh fa-spin"></i>')
				.show();
				$("#tableContents").empty();

				//options to send to the variantCall
				varSet.pageToken = undefined;
				//variant Call
				getVariantCallSet().then(function(){
					$("#frangipani-new-search").text = "New Search";	
					loadPatientsOnScroll(getVariantCallSet,'patient');
					$('#frangipani-new-search').empty().text("NewSearch")	
				});


				
			} else {
				//preliminary alert
				settings.buttonClicked = false
				$('#myModal').foundation('reveal','open');
				resetSearchFields();

			}
			
		}

	});
};


/* When attached to a function, this event handler watches
 * the screen to keep track of when the user has reached the
 * bottom of the current table. When this happens, that attached
 * function is triggered, populating the next page of the table
 * this allows for continuous scrolling.
*/
var loadPatientsOnScroll= function(addContentFunction,ref) {
	$(window).on("scroll.table", function(event) {
		if (ref === 'project'){
			var refPoint = settings.currentData;
		} else if (ref === 'patient'){
			var refPoint = settings.currentData.variants;
		}
		if (!settings.scrolledToBottom &&
			refPoint.pageToken != "" && refPoint.pageToken !== undefined &&
			$(window).scrollTop() + $(window).height() >= settings.patientTable.height()) {
			settings.scrolledToBottom= true;
			settings.progressSpinner.show();	
			addContentFunction();
		}
	});
};

/* Add the app event listeners */
var addProjectEventListeners= function() {
	clickAction($(".frangipani-project-name"), getProjectPatients, {}, true);
	$('.frangipani-project-name').on('click',toggleProjectsSideBar);
	loadPatientsOnScroll(getProjectPatients, 'project');
};


/*
* Main app function.
*/

var app= function() {
	settings.applicationMain= $("#frangipani-app-main");
	clickAction($("#frangipani-browse-button"), getProjects);
};
/* App components */
var refresh= function() {
	settings.patientTable= $("#frangipani-project-details");
	settings.progressSpinner= $("#frangipani-progress-spinner");
};


/* 
 * Wait for the DOM to load before any processing.
 */
$(document).ready(app);








