/* Node module for the annotaion, parsing and uploading of a vcf file to a
 * running database (currently set to mongodb). the input is first checked
 * to ensure proper file formats are uploaded, annoation paths are set
 * and the options provided are correct. Additionally currently the module
 * specifies the option table as a required option to provide a table name.
 * this will eventually be removed and changed to patientname with the table
 * name automatically being determined.
 *
 *
 * Written by Patrick Magee
*/
var Promise = require("../node_modules/bluebird");
//var db = require("../frangipani_node_modules/DB");
var fs = Promise.promisifyAll(require('fs')); 
var path = require("path");
var glob = Promise.promisifyAll(require("../node_modules/glob"));
var child_process=Promise.promisifyAll(require('child_process'));
var dbConstants = require('../frangipani_node_modules/mongodb_constants');
var Parser = require('./parseVCF');


//Custom Errors for event handling
function InputError(message){
		this.name = "InputError";
		this.message = ( message || "" );
		Error.call(this);
		Error.captureStackTrace(this,this.constructor);
};
InputError.prototype = Object.create(Error.prototype);
InputError.prototype.constructor = InputError;

function AnnotationError(message){
		this.name = "AnnotationError";
		this.message = ( message || "" );
		Error.call(this);
		Error.captureStackTrace(this,this.constructor);
};
AnnotationError.prototype = Object.create(Error.prototype);
AnnotationError.prototype.constructor = AnnotationError;

function ParseError(message){
		this.name = "ParseError";
		this.message = ( message || "" );
		Error.call(this);
		Error.captureStackTrace(this,this.constructor);
};
ParseError.prototype = Object.create(Error.prototype);
ParseError.prototype.constructor = ParseError;

function AnnovarError(message){
	this.name = "AnnovarError";
	this.message = ( message || "" );
	Error.call(this);
	Error.captureStackTrace(this,this.constructor);
};
AnnovarError.prototype = Object.create(Error.prototype);
AnnovarError.prototype.constructor = AnnovarError;



/* annotateAndAddVariants:
 * Main function that facilitates the annotation of variants
 * as well as their addition to a databse. It takes a single parameter:
 * 'options' which is a js object that contains the following arguments:
 *
 * input: path to input file in vcf format. REQUIRED
 * patients: an array with objects corresponding to individual patients with a mapped table property
 * 
 */

function annotateAndAddVariants(options){
	//new promise to return
	var promise = new Promise(function(resolve,reject){
		var annovarPath
		var annodbString;
		var dbusageString;
		var inputFile = path.resolve(options['input']);
		var tempOutputFile;

		//Check to see whether input file exists and if annovarPath exists
		dbFunctions.find('admin',{},{'annovar-path':1,'annovar-dbs':1})
		.then(function(result){
			annodbString = 'refgene'//result[0]['annovar-dbs'].join();
			annovarPath = result[0]['annovar-path'];
			dbusageString = 'g'//result[0]['annovar-usage'].join();
			//dbusage = result[0]['annovar-usage']
		}).then(function(){
			return fs.statAsync(inputFile)
		}).then(function(result){
			var newFile = inputFile.replace(/\(|\)/gi,"").replace(/\s/gi,"_");
			return fs.renameAsync(inputFile,newFile).then(function(){
				inputFile = newFile;
				tempOutputFile = inputFile + '.hg19_multianno.txt';
			});
		}).then(function(){
			return fs.statAsync(annovarPath);
		}).then(function(){
			return options['patients'];
		}).each(function(patient){
			//create newTable and raise exception oif tablname already exists
			var collectionName = patient[dbConstants['COLLECTION_ID_FIELD']];
			return dbFunctions.createCollection(collectionName).then(function(){
				return dbFunctions.createIndex(collectionName,{'Chr':1,'Start':1,'End':1});
			}).catch(function(err){console.log(err.stack)});
		}).then(function(){
			//add event logging
			var execPath = path.resolve(annovarPath + '/table_annovar.pl');
			var dbPath = path.resolve(annovarPath + "/humandb/");
			//var logFile = path.resolve(annovarPath + "/log.txt");
			var annovarCmd = 'perl \"'  + execPath +  "\" \"" + inputFile + '\" \"' + dbPath + '\"  -buildver hg19 -operation ' + dbusageString + '  -nastring . -vcfinput ' + 
				'-protocol  ' + annodbString;

			//run annovar command as a child process
			return child_process.execAsync(annovarCmd,{maxBuffer:1000000*1024});
		})
		.then(function(err,stdout,stderr){
			//if an error occurs during running annovarCmd raise a new error
			if (stderr != null){
				throw new AnnovarError(stderr);
			}
		})
		.then(function(){
			//check to ensure the tempOutFile was created
			return fs.statAsync(tempOutputFile);
		}).then(function(){
			var parser = new Parser(tempOutputFile,options['patients'],dbFunctions);
			return parser.read();
		}).then(function(){
			resolve('completed Annotation and uploaded  entries');
		}).catch(function(err){
			//Need more robust error handler here for solving issues
			console.log(err);
		}).done(function(){
			//Cleanup, remove files and close db connection
			return glob.globAsync(inputFile + "*")
			.each(function(file){
				return fs.unlinkAsync(file);
			})
		});
		/*
		*  Custom error handlers for future use
		* 
		*
		.catch(MongoError,function(err){ //Eventually add custom events to custom errros
			//console.log(err)
			/*if (tableName exists)
			 *	remove table
			 
			console.log(err.message);
			console.log(err.stack);
			reject(err)
		})

		.catch(InputError,function(err){
			//console.log(err);

			console.log(err)
			reject(err)
		})
		.catch(ParseError,function(err){
			console.log(err);
			console.log(err.stack);
			reject(err);

		})
		.catch(AnnovarError,function(err){
			console.log(err);
			reject(err);
		})
		*/
		/*
		.catch(function(err){
			return dbFunctions.dropCollection(tableName)
			.then(function(){
				console.log(err);
			}).catch(function(drop_err){
				console.log(drop_err);
			})
		})
*/
/*		
			.catch(function(err){
				//do nothing
				return null;
			});
		})*/
			
	});
	
	return promise;
}

module.exports = annotateAndAddVariants

	
		








