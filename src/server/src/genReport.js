var phantom = require('phantom');
var Promise = require('bluebird');
var constants = require("./conf/constants.json");
var cons = Promise.promisifyAll(require('consolidate')); // Promisify consolidate
var Handlebars = require("handlebars");
var fs = Promise.promisifyAll(require('fs'));
var Path = require('path');
var _ = require('lodash');
var moment = require('moment');



//add the handlebars helper functions

/**
 * look in the defined array at the specified index and check to see if the
 * cnv index does not == 0. if it equals zero do not continue, if not
 * return the block
 */
Handlebars.registerHelper('ifCnv',function(cnvArr,index,block){
	//var fnTrue = options.fn, fnFalse = options.inverse;
	accum = "";
	if (cnvArr && cnvArr[index] !== 0){
		accum+= block.fn(cnvArr[index]);
	}
	return accum;
});


/* Generate Reports based on the template provided and send the name of the report to the client
 * once the report has been rendered for easy downloading.
 * The function takes in four mandatory fields:
 * req
 * res
 * reportName: the name to be given to a report. the date and month will be added to the report to create a unique name
 * template: the tamplate name to use for rendering
 *
 * The function uses the handlebars engine which is being run within the consolidate package in order to generate
 * html files. From three the file is passed to an instance of phantomjs to be rendered as a PDF. The rendering
 * can sometimes take a few seconds leading to noticable lag on the client side. Once the file has been rendered and
 * saved in the temp folder, a response is sent to the client, with the reportName to retrieve from the server.
 */
module.exports = function(req,res,reportName,template,options,logger){
	var name,path,top,bottom,left,right,format,orientation;

	//Page size and margin parameter defaults
	options = _.assign({
		top: '1cm',
		bottom: '1cm',
		left: '1cm',
		right: '1cm',
		format: 'Letter',
		orientation: 'portrait'
	}, options);

	//get template dir and pass this information into the handlebars template,
	//This can be used to ensure proper inclusion of CSS and other elements for non
	//Default templates
	req.body.DIR = Path.resolve(template.replace(/\/([^\/])*$/,""));
	//console.log(req.body.DIR);

	var ph; // phantom instance
	var phPage; // phantom page

	var opts = req.body;

	var date = moment().format('D MMMM YYYY');

	//Turn the process into a promise.
	return Promise.resolve().then(function(){

		var dobToStr = function( dob ){
			return [ dob.year, dob.month, dob.day ].map(function( n ){
				if( n < 10 ){
					return '0' + n;
				} else {
					return '' + n;
				}
			}).join('-');
		};

		//the date and time are appending to the report name in order to make a unique report name, in the case of multiple files sharing the same name
		name = reportName + "_report_" + moment().format('D_MMMM_YYYY_[at]_HHmm_ss');
		path = Path.resolve(constants.nodeConstants.TMP_UPLOAD_DIR + '/' + name);
		path = path.replace(/\\/gi,'/');
		//The options from the intial request will be ussed to populate the template. Additionally add user info and date info
		opts.user = req.user[constants.dbConstants.USERS.ID_FIELD];
		opts.date = { day: moment().format('D'), month: moment().format('MMMM'), year: moment().format('YYYY') };
		opts.patient.dob.month = moment( dobToStr( opts.patient.dob ) ).format('MMMM');
		//Render the Templates Asynchronously
		return cons.handlebarsAsync(template,opts);
	}).then(function(html){
		return fs.writeFileAsync(path + '.html',html); // write the html to file
	}).then(function(){
		return phantom.create(['--web-security=no', '--ignore-ssl-errors=yes']);
	}).then(function( instance ){
		return (ph = instance);
	}).then(function(){
		return ph.createPage();
	}).then(function( page ){
		return (phPage = page);
	}).then(function(){
		return phPage.property( 'paperSize', {
			format: options.format,
			orientation: options.orientation,
			margin: _.pick( options, ['top', 'bottom', 'left', 'right'] ),
			footer: {
				height: '1cm',
				contents: ph.callback(function( pageNum, numPages ){
					return "<div style='font-size: 10pt; text-align: center; font-family: palatino linotype, book antiqua, palatino, georgia, serif; position: relative;'>" +
						// " <div style='position: absolute; left: 0;'>" + "NAME" + "</div> " +
						// " <div style='position: absolute; right: 0;'>" + "DATE" + "</div> " +
						" Page " + pageNum + " of " + numPages +
					"</div>";
				})
			}
		} );
	}).then(function(){
		// use standard 16:9 res but doesn't really matter for pdf output...
		return phPage.property('viewportSize', { width: 1360, height: 768 });
	}).then(function(){
		return phPage.open('file:///' +  path + '.html');
	}).then(function( status ){
		if (status !== "success") {
			throw new Error("file did not open properly");
		}
	}).then(function(){
		return phPage.render( path + '.pdf' );
	}).then(function(){
		// Exit phantom on success
		ph.exit();

		//Send the name of the rendered pdf file
		return res.send( JSON.stringify({
			name: name + '.pdf'
		}) );
	}).catch(function(err){
		if( ph ){ ph.exit(); }

		console.log(err.stack);
		logger('error',err,{user:req.user[constants.dbConstants.USERS.ID_FIELD],'action':'genReport','target':name});
		throw new Error(err);
	});
};
