(function(root) {
	var factory = (function(Backbone, _) {
		// ====== [UTILS] ======
		function S4() {
           return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
        };
        
        // Generate a pseudo-GUID by concatenating random hexadecimal.
        function guid() {
           return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
        };

		// ====== [ WebSQLStore ] ======

		var WebSQLStore = function(db, tableName, columns, initSuccessCallback, initErrorCallback) {
			// make columns optional for backwards compatibility w/ original API
			if ( typeof columns == 'function') {
				initErrorCallback = initSuccessCallback;
				initSuccessCallback = columns;
				columns = null;
			}

			this.tableName = tableName;
			this.db = db;
			this.columns = columns || [];
			
			if (! _.find(this.columns, function(item){return item.name === "id"})){
			     this.columns.push({
			         name: 'id',
			         type: 'string',
			         unique: true
			     });   
			}
			
			var success = function(tx, res) {
				if (initSuccessCallback)
					initSuccessCallback();
			};
			var error = function(tx, error) {
				console.error("Error while create table", error);
				if (initErrorCallback)
					initErrorCallback();
			};
			
			var colDefns = [];
			colDefns = colDefns.concat(this.columns.map(createColDefn));
			this._executeSql("CREATE TABLE IF NOT EXISTS `" + tableName + "` (" + colDefns.join(", ") + ");", null, success, error, {});
		};
		
		WebSQLStore.debug = false;
		
		WebSQLStore.insertOrReplace = false;
		
		_.extend(WebSQLStore.prototype, {

			create : function(model, success, error, options) {
				//when you want use your id as identifier, use apiid attribute
				if (!model.attributes[model.idAttribute]) {
					// Reference model.attributes.apiid for backward compatibility.
					var obj = {};

					if (model.attributes.apiid) {
						obj[model.idAttribute] = model.attributes.apiid;
						delete model.attributes.apiid;
					} else {
						obj[model.idAttribute] = guid();
					}
					model.set(obj);
				}

				var colNames = [];
				var placeholders = [];
				var params = [];
				
				_.each(this.columns, function(col){
				    colNames.push("`" + col.name + "`");
                    placeholders.push(['?']);
                    params.push(model.attributes[col.name]);                        
				});
				
				var orReplace = WebSQLStore.insertOrReplace ? ' OR REPLACE' : '';
				this._executeSql("INSERT" + orReplace + " INTO `" + this.tableName + "`(" + colNames.join(",") + ") VALUES(" + placeholders.join(",") + ");", params, success, error, options);
			},

			update : function(model, success, error, options) {
				if (WebSQLStore.insertOrReplace)
					return this.create(model, success, error, options);

				var modelKeys = _.map(model.attributes, function(value, key){return key;});
				var columnsKeys = this._listOfColumns();

                var news =_.difference(modelKeys, columnsKeys);
                
                var SQLs = [];
                
                if (news.length != 0){
                    for (var i=0; i < news.length; i++) {
                        this.columns.push({
                            name: news[i],
                            type: 'string'
                        });
                        
                        SQLs.push({
                            SQL : "ALTER TABLE `" + this.tableName + "` ADD COLUMN `" + news[i] + "` TEXT;" //TEXT by default
                        });
                    };
                }
                
                var setStmts = [];
                var params = [];
				_.each(this.columns, function(col) {
				    if (col.name === model.idAttribute){ //we do not update the `id` attribute
				        return;
				    }
				    
					var data = model.attributes[col.name];
					if (typeof data !== "undefined") {   //we do not update if the value of a field is undefined
						setStmts.push("`" + col.name + "`=?");
						params.push(data);
					}
				});
				params.push(model.attributes[model.idAttribute]);//We compare with the `id` in the WHERE clausule
				
				SQLs.push({
                    SQL: "UPDATE `" + this.tableName + "` SET " + setStmts.join(" , ") + " WHERE(`"+ model.idAttribute +"`=?);",
                    params: params,
                    successCallback: function(tx, result) {
                        if (result.rowsAffected == 1)
                            success(tx, result);
                        else
                            error(tx, new Error('UPDATE affected ' + result.rowsAffected + ' rows'));
                    },
                    error: error
                });
				
				this._executeSqlBulk(SQLs, null, options);
			},

			destroy : function(model, success, error, options) {
				var id = (model.attributes[model.idAttribute] || model.attributes.id);
				this._executeSql("DELETE FROM `" + this.tableName + "` WHERE(`" + model.idAttribute + "`=?);", [id], success, error, options);
			},

			find : function(model, success, error, options) {
				var id = (model.attributes[model.idAttribute] || model.attributes.id);
				this._executeSql("SELECT " + this._listOfColumns().join(", ") + " FROM `" + this.tableName + "` WHERE(`" + model.idAttribute + "`=?);", [id], success, error, options);
			},

			findAll : function(model, success, error, options) {
				var params = [];
				var sql = "SELECT " + this._listOfColumns().join(", ") + " FROM `" + this.tableName + "`";
				if (options.filters) {
					if ( typeof options.filters == 'string') {
						sql += ' WHERE ' + options.filters;
					} else if ( typeof options.filters == 'object') {
						sql += ' WHERE ' + Object.keys(options.filters).map(function(col) {
							params.push(options.filters[col]);
							return '`' + col + '` = ?';
						}).join(' AND ');
					} else {
						throw new Error('Unsupported filters type: ' + typeof options.filters);
					}
				}
				this._executeSql(sql, params, success, error, options);
			},
			
			_listOfColumns: function(){
			     return _.map(this.columns, function(value){return value.name;});  
			},

			_executeSql : function(SQL, params, successCallback, errorCallback, options) {
				var success = function(tx, result) {
					if (WebSQLStore.debug) {
						console.log(SQL, params, " - finished");
					}
					if (successCallback)
						successCallback(tx, result);
				};
				var error = function(tx, error) {
					if (WebSQLStore.debug) {
						console.error(SQL, params, " - error: " + error)
					};
					if (errorCallback)
						return errorCallback(tx, error);
				};

				if (options.transaction) {
					options.transaction.executeSql(SQL, params, success, error);
				} else {
					this.db.transaction(function(tx) {
						tx.executeSql(SQL, params, success, error);
					});
				}
			},
			
			/**
			 * Execute a list of SQL statment in the same transaction in order.
			 * 
             * @param {Object} SQLs array of {SQL, params, successCallback, errorCallback} objects
             * @param {function} endCallback callback when the last statment finishes
             * @param {Object} options might contain an existing transaction
			 */
            _executeSqlBulk : function(SQLs, endCallback, options) {

                var iterateSQL = function(transaction) {

                    for (var i = 0; i < SQLs.length; i++) {
                        var SQL = SQLs[i].SQL;
                        var params = SQLs[i].params;
                        var successCallback = SQLs[i].successCallback;
                        var errorCallback = SQLs[i].errorCallback;

                        var success;
                        
                        if (endCallback && (i == SQLs.length - 1)){
                            success = function(cbk, endCbk) {
                                return function(tx, result) {
                                    if (cbk)
                                        cbk(tx, result);
                                    
                                    endCbk();
                                }
                            }(successCallback, endCallback);
                        }else{
                            success = function(cbk) {
                                return function(tx, result) {
                                    if (cbk)
                                        cbk(tx, result);
                                }
                            }(successCallback);
                        }

                        var error = function(cbk) {
                            return function(tx, error) {
                                if (cbk)
                                    cbk(tx, error);
                            }
                        }(errorCallback);

                        transaction.executeSql(SQL, params, success, error);
                    };

                };

                if (options && options.transaction) {
                    iterateSQL(options.transaction);
                } else {
                    this.db.transaction(function(tx) {
                        iterateSQL(tx);
                    });
                }
            }
         });

		// ====== [ Backbone.sync WebSQL implementation ] ======

		Backbone.sync = function(method, model, options) {
			var success, error, store = model.getStore() || model.collection.getStore();

			if (store == null) {
				console.warn("[BACKBONE-WEBSQL] model without store object -> ", model);
				return;
			}
			var isSingleResult = false;

			success = function(tx, res) {
				var len = res.rows.length, result;
				if (len > 0) {
				    
				    var parseResult = function(item){
				        var obj = {};
				        
				        _.each(item, function(val, key) {
						  obj[key] = val;
						});
						
						return obj;
				    };

					if (isSingleResult) {
						result = parseResult(res.rows.item(0));
					} else {
						result = [];

						var i;
						for ( i = 0; i < len; i++) {
							result.push(parseResult(res.rows.item(i)));
						}
					}
				}

				options.success(result);
			};
			
			error = function(tx, error) {
				console.error("sql error");
				console.error(error.message);
			};

			switch(method) {
				case "read":
					if (model.attributes && model.attributes[model.idAttribute]) {
						isSingleResult = true;
						store.find(model, success, error, options)
					} else {
						store.findAll(model, success, error, options)
					}

					break;
				case "create":
					store.create(model, success, error, options);
					break;
				case "update":
					store.update(model, success, error, options);
					break;
				case "delete":
					store.destroy(model, success, error, options);
					break;
				default:
					console.error(method);
			}
		};

		var typeMap = {
			"number":   "INTEGER",
			"string":   "TEXT",
			"boolean":  "BOOLEAN",
			"array":    "LIST",
			"datetime": "TEXT",
			"date":     "TEXT",
			"object":   "TEXT"
		};
	
		function createColDefn(col) {
			if (col.type && !(col.type in typeMap))
				throw new Error("Unsupported type: " + col.type);

			var defn = "`" + col.name + "`";
			
			if (col.type) {
				if (col.scale)
					defn += " REAL";
				else
					defn += " " + typeMap[col.type];
			}
			
			if (col.unique){
			    defn += ' UNIQUE';
			}
			
			return defn;
		}
		
		return WebSQLStore
	})
	if ( typeof exports !== 'undefined') {
		factory(require('Backbone'), require('underscore'));
	} else if ( typeof define === 'function' && define.amd) {
		define(['Backbone', 'underscore'], factory);
	} else {
		root.WebSQLStore = factory(root.Backbone, root._)
	}
})(this)
