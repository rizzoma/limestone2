var tcp = require('net');
var sys = require('sys');

exports.SphinxClient = function() {
    var self = { };

    var buffer_extras = require('./buffer_extras');

    var Sphinx = {
        port:	9312
    };

    // All search modes
    Sphinx.searchMode = {
        "ALL":			0,
        "ANY":			1,
        "PHRASE":		2,
        "BOOLEAN":		3,
        "EXTENDED":		4,
        "FULLSCAN":		5,
        "EXTENDED2":	6    // extended engine V2 (TEMPORARY, WILL BE REMOVED)
    };
    self.SEARCH_MODE = Sphinx.searchMode;

    // All ranking modes
    Sphinx.rankingMode = {
        "PROXIMITY_BM25":	0,    ///< default mode, phrase proximity major factor and BM25 minor one
        "BM25":				1,    ///< statistical mode, BM25 ranking only (faster but worse quality)
        "NONE":				2,    ///< no ranking, all matches get a weight of 1
        "WORDCOUNT":		3,    ///< simple word-count weighting, rank is a weighted sum of per-field keyword occurence counts
        "PROXIMITY":		4,
        "MATCHANY":			5,
        "FIELDMASK":		6,
        "SPH04":			7,
        "TOTAL":			8
    };
    self.RANKING_MODE = Sphinx.rankingMode;

    Sphinx.sortMode = {
        "RELEVANCE":		0,
        "ATTR_DESC":		1,
        "ATTR_ASC":			2,
        "TIME_SEGMENTS":	3,
        "EXTENDED":			4,
        "EXPR":				5
    };
    self.SORT_MODE = Sphinx.sortMode;

    Sphinx.groupFunc = {
        "DAY":		0,
        "WEEK":		1,
        "MONTH":	2,
        "YEAR":		3,
        "ATTR":		4,
        "ATTRPAIR":	5
    };
    self.GROUP_FUNC = Sphinx.groupFunc;

    // Commands
    Sphinx.command = {
        "SEARCH":		0,
        "EXCERPT":		1,
        "UPDATE":		2,
        "KEYWORDS":		3,
        "PERSIST":		4,
        "STATUS":		5,
        "QUERY":		6,
        "FLUSHATTRS":	7
    };

    // Current version client commands
    Sphinx.clientCommand = {
        "SEARCH":		0x118,
        "EXCERPT":		0x103,
        "UPDATE":		0x102,
        "KEYWORDS":		0x100,
        "STATUS":		0x100,
        "QUERY":		0x100,
        "FLUSHATTRS":	0x100
    };

    Sphinx.statusCode = {
        "OK":		0,
        "ERROR":	1,
        "RETRY":	2,
        "WARNING":	3
    };

    Sphinx.filterTypes = {
        "VALUES":		0,
        "RANGE":		1,
        "FLOATRANGE":	2
    };
    self.FILTER_TYPES = Sphinx.filterTypes;

    Sphinx.attribute = {
        "INTEGER":		1,
        "TIMESTAMP":	2,
        "ORDINAL":		3,
        "BOOL":			4,
        "FLOAT":		5,
        "BIGINT":		6,
        "STRING":		7,
        "MULTI":		0x40000001
    };

    var server_conn;
    var connection_status;
    var response_output;

    // Connect to Sphinx server
    self.connect = function(port, callback) {

        server_conn = tcp.createConnection(port || Sphinx.port);
        // disable Nagle algorithm
        server_conn.setNoDelay(true);
        //server_conn.setEncoding('binary');

        response_output = null;

        //var promise = new process.Promise();

        server_conn.addListener('error', function (err) {
           if (err) {
               callback(err);
           } 
        });

        server_conn.addListener('connect', function () {

            //sys.puts('Connected, sending protocol version... State is ' + server_conn.readyState);
            // Sending protocol version
            // sys.puts('Sending version number...');
            // Here we must send 4 bytes, '0x00000001'
            if (server_conn.readyState == 'open') {
                var version_number = Buffer.makeWriter();
                version_number.push.int32(1);
                server_conn.write(version_number.toBuffer());

                // Waiting for answer
                server_conn.on('data', function(data) {
                    /*if (response_output) {
                        sys.puts('connect: Data received from server');
                    }*/

                    // var data_unpacked = binary.unpack('N*', data);
                    var receive_listeners = server_conn.listeners('data');
                    var i, z;
                    for (i = 0; i < receive_listeners.length; i++) {
                        server_conn.removeListener('data', receive_listeners[i]);
                    }
                    var protocol_version_raw = data.toReader();
                    var protocol_version = protocol_version_raw.int32();
                    var data_unpacked = {'': protocol_version};

                    //  console.log('Protocol version: ' + protocol_version);

                    if (data_unpacked[""] >= 1) {

                        // Remove listener after handshaking
                        var listeners = server_conn.listeners('data');
                        for (z = 0; z < listeners.length; z++) {
                            server_conn.removeListener('data', listeners[z]);
                        }

                        // Simple connection status indicator
                        connection_status = 1;

                        server_conn.on('data', readResponseData);

                        // Use callback
                        // promise.emitSuccess();
                        callback(null);

                    } else {
                        callback(new Error('Wrong protocol version: ' + protocol_version));
                    }

                });
                server_conn.on('error', function(exp) {
                    console.log('Error: ' + exp);
                });
            } else {
                callback(new Error('Connection is ' + server_conn.readyState + ' in OnConnect'));
            }
        });

    };

    // sys.puts('Connecting to searchd...');

    self.query = function(query_raw, callback) {
        var query = new Object();

        initResponseOutput(callback);

        var query_parameters = {
            offset			: 0,
            limit			: 20,
            mode			: Sphinx.searchMode.ALL,
            weights			: [],
            sort			: Sphinx.sortMode.RELEVANCE,
            sortby			: "",
            min_id			: 0,
            max_id			: 0,
            filters			: [],
            groupby			: "",
            groupfunc		: Sphinx.groupFunc.DAY,
            groupsort		: "@group desc",
            groupdistinct	: "",
            maxmatches		: 1000,
            cutoff			: 0,
            retrycount		: 0,
            retrydelay		: 0,
            anchor			: [],
            indexweights	: [],
            ranker			: Sphinx.rankingMode.PROXIMITY_BM25,
            maxquerytime	: 0,
            weights			: [],
            overrides 		: [],
            selectlist		: "*",
            indexes			: '*',
            comment			: '',
            query			: "",
            error			: "", // per-reply fields (for single-query case)
            warning			: "",
            connerror		: false,
            reqs			: [],	// requests storage (for multi-query case)
            mbenc			: "",
            arrayresult		: true,
            timeout			: 0
        };

        // if (query_raw.query) {
            for (var x in query_parameters) {
                if (query_raw.hasOwnProperty(x)) {
                    query[x] = query_raw[x];
                } else {
                    query[x] = query_parameters[x];
                }
            }
        /* } else {
            query = query_raw.toString();
        }*/

        /* if (connection_status != 1) {
         sys.puts("You must connect to server before issuing queries");
         return false;
         }*/

        var request = Buffer.makeWriter(); 
        request.push.int16(Sphinx.command.SEARCH);
        request.push.int16(Sphinx.clientCommand.SEARCH);

        request.push.int32(0); // This will be request length
        request.push.int32(0);
        request.push.int32(1);

        request.push.int32(query.offset);

        request.push.int32(query.limit);

        request.push.int32(query.mode);
        request.push.int32(query.ranker);

        request.push.int32(query.sort);

        request.push.lstring(query.sortby); 
        request.push.lstring(query.query); // Query text
        request.push.int32(query.weights.length); 
        for (var i = 0; i < query.weights.length; i++) {
            var weight = query.weights[i];
            request.push.int32(parseInt(weight));
        }

        request.push.lstring(query.indexes); // Indexes used

        request.push.int32(1); // id64 range marker

        //request.push.int32(0);
        request.push.int64(0, query.min_id); // This is actually supposed to be two 64-bit numbers
        //request.push.int32(0); //  However, there is a caveat about using 64-bit ids
        request.push.int64(0, query.max_id); 

        request.push.int32(query.filters.length); 
        for (var i = 0; i < query.filters.length; i++) {
            var filter = query.filters[i];
            request.push.lstring(filter.attr);
            request.push.int32(filter.type);
            switch (filter.type) {
                case Sphinx.filterTypes.VALUES:
                    request.push.int32(filter.values.length);
                    for (var j = 0; j < filter.values.length; j++) {
                        var value = filter.values[j]
                        //request.push.int32(0); // should be a 64-bit number
                        request.push.int64(0, value);
                    }
                    break;
                case Sphinx.filterTypes.RANGE:
                    //request.push.int32(0); // should be a 64-bit number
                    request.push.int64(0, filter.min);
                    //request.push.int32(0); // should be a 64-bit number
                    request.push.int64(0, filter.max);
                    break;
                case Sphinx.filterTypes.FLOATRANGE:
                    request.push.float(filter.min);
                    request.push.float(filter.max);
                    break;
            }
            request.push.int32(filter.exclude);
        }
        
        request.push.int32(query.groupfunc);
        request.push.lstring(query.groupby); // Groupby length

        request.push.int32(query_parameters.maxmatches); // Maxmatches, default to 1000

        request.push.lstring(query.groupsort); // Groupsort

        request.push.int32(query_parameters.cutoff); // Cutoff
        request.push.int32(query_parameters.retrycount); // Retrycount
        request.push.int32(query_parameters.retrydelay); // Retrydelay

        request.push.lstring(query.groupdistinct); // Group distinct

        if (query_parameters.anchor.length == 0) {
            request.push.int32(0); // no anchor given
        } else {
            request.push.int32(1); // anchor point in radians
            request.push.lstring(query_parameters.anchor["attrlat"]); // Group distinct
            request.push.lstring(query_parameters.anchor["attrlong"]); // Group distinct
            request.push.float(query_parameters.anchor["lat"]);
            request.push.float(query_parameters.anchor["long"]);
        }

        request.push.int32(query_parameters.indexweights.length);
        for (var i = 0; i < query_parameters.indexweights.length; i++) {
            var item = query_parameters.indexweights[i];
            request.push.lstring(item.index);
            request.push.int32(item.weight);
        }

        request.push.int32(query_parameters.maxquerytime); 

        request.push.int32(query.weights.length);
        for (var i = 0; i < query.weights.length; i++) {
            var item = query.weights[i];
            request.push.int32(i);
            request.push.lstring(item.field);
            request.push.int32(item.weight);
        }

        request.push.lstring(query_parameters.comment); 

        request.push.int32(query_parameters.overrides.length);
        for (var i = 0; i < query_parameters.overrides.length; i++) {
            var override = query_parameters.overrides[i];
            request.push.lstring(override.attr); 
            request.push.int32(override.type);
            request.push.int32(override.values.length);
            for (var j = 0; j < override.values.length; j++) {
                var item = override.values[j];
                request.push.int64(0, item.id);
                switch (override.type) {
                    case Sphinx.attribute.FLOAT:
                        request.push.float(item.value);
                        break;
                    case Sphinx.attribute.BIGINT:
                        request.push.int64(0, item.value);
                        break;
                    default:
                        request.push.int32(item.value);
                        break;
                }
            }
        }

      request.push.lstring(query.selectlist); // Select-list

      var request_buf = request.toBuffer();
      var req_length = Buffer.makeWriter();
      req_length.push.int32(request_buf.length - 8);
      req_length.toBuffer().copy(request_buf, 4, 0);

      //console.log('Sending request of ' + request_buf.length + ' bytes');
      server_conn.write(request_buf);
    };

    self.disconnect = function() {
        server_conn.end();
    };

    function readResponseData(data) {
        // Got response!
        // Command must match the one used in query
        response_output.append(data);
    }

    function initResponseOutput(query_callback) {
        response_output = {
            status  : null,
            version : null,
            length  : 0,
            data    : new Buffer(0),
            parseHeader : function() {
                if (this.status === null && this.data.length >= 8) {
                    // console.log('Answer length: ' + (this.data.length));
                    var decoder = this.data.toReader();
                    // var decoder = new bits.Decoder(this.data);

                    this.status  = decoder.int16();
                    this.version = decoder.int16();
                    this.length  = decoder.int32();
                    // console.log('Receiving answer with status ' + this.status + ', version ' + this.version + ' and length ' + this.length);

                    this.data = this.data.slice(8, this.data.length);
                    // this.data = decoder.string(this.data.length - 8);
                }
            },
            append  : function(data) {
                //this.data.write(data.toString('utf-8'), 'utf-8');
                // sys.puts('Appending ' + data.length + ' bytes');
                var new_buffer = new Buffer(this.data.length + data.length);
                this.data.copy(new_buffer, 0, 0);
                data.copy(new_buffer, this.data.length, 0);
                this.data = new_buffer;
                // console.log('Data length after appending: ' + this.data.length);
                this.parseHeader();
                this.runCallbackIfDone();
            },
            done : function() {
                // console.log('Length: ' + this.data.length + ' / ' + this.length);
                return this.data.length >= this.length;
            },
            checkResponse : function(search_command) {
                var errmsg = '';
                if (this.length !== this.data.length) {
                    errmsg += "Failed to read searchd response (status=" + this.status + ", ver=" + this.version + ", len=" + this.length + ", read=" + this.data.length + ")";
                }

                if (this.version < search_command) {
                    errmsg += "Searchd command older than client's version, some options might not work";
                }

                if (this.status == Sphinx.statusCode.WARNING) {
                    errmsg += "Server issued WARNING: " + this.data;
                }

                if (this.status == Sphinx.statusCode.ERROR) {
                    errmsg += "Server issued ERROR: " + this.data;
                }
                return errmsg;
            },
            runCallbackIfDone : function() {
                if (this.done()) {
                    var answer;
                    var errmsg = this.checkResponse(Sphinx.clientCommand.SEARCH);
                    if (!errmsg) {
                        answer = parseSearchResponse(response_output.data);
                    }
                    query_callback(errmsg, answer);
                }
            }
        };
    }

    var parseSearchResponse = function (data) {
        var output = {};
        // var response = new bits.Decoder(data);
        var response = data.toReader();

        output.status = response.int32();
        if (output.status != 0) {
            return(response.lstring());
        }
        output.num_fields = response.int32();

        output.fields = [];
        output.attributes = [];
        output.matches = [];

        // Get fields
        for (var i = 0; i < output.num_fields; i++) {
            var field = {};

            field.name = response.lstring();

            output.fields.push(field);
        }

        output.num_attrs = response.int32();

        // Get attributes
        for (var i = 0; i < output.num_attrs; i++) {
            var attribute = {};

            attribute.name = response.lstring();
            attribute.type = response.int32();
            output.attributes.push(attribute);
        }

        output.match_count = response.int32();
        output.id64 = response.int32();

        // Get matches
        for (var i = 0; i < output.match_count; i++) {
            var match = {};

            // Here server tells us which format for document IDs
            // it uses: int64 or int32
            if (output.id64 == 1) {
                // get the 64-bit result, but only use the lower half for now
                var id64 = response.int64();
                match.doc = id64[1];
                match.weight = response.int32();
            } else {
                // Good news: document id fits our integers size :)
                match.doc = response.int32();
                match.weight = response.int32();
            }

            match.attrs = {};

            // match attributes
            for (var j = 0; j < output.attributes.length; j++) {
                var attribute = output.attributes[j];
                // BIGINT size attributes (64 bits)
                if (attribute.type == Sphinx.attribute.BIGINT) {
                    var attr_value = response.int32();
                    attr_value = response.int32();
                    match.attrs[attribute.name] = attr_value;
                    continue;
                }

                // FLOAT size attributes (32 bits)
                if (attribute.type == Sphinx.attribute.FLOAT) {
                    var attr_value = response.int32();
                    match.attrs[attribute.name] = attr_value;
                    continue;
                }

                // STRING attributes
                if (attribute.type == Sphinx.attribute.STRING) {
                    var attr_value = response.lstring();
                    match.attrs[attribute.name] = attr_value;
                    continue;
                }

                // MULTI attributes
                if (attribute.type == Sphinx.attribute.MULTI) {
                    var attr_value_count = response.int32();
                    match.attrs[attribute.name] = []
                    for (var k = 0; k < attr_value_count; k++) {
                        var attr_value = response.int32();
                        match.attrs[attribute.name].push(attr_value);
                    }
                    continue;
                }
                // We don't need this branch right now,
                // as it is covered by previous `if`
                var attr_value = response.int32();
                match.attrs[attribute.name] = attr_value;
            }

            output.matches.push(match);

        }

        output.total = response.int32();
        output.total_found = response.int32();
        output.msecs = response.int32();
        output.words_count = response.int32();
        output.words = new Object();
        for (var i = 0; i < output.words_count; i++) {
            var word = response.lstring();
            output.words[word] = new Object();
            output.words[word]["docs"] = response.int32();
            output.words[word]["hits"] = response.int32();
        }
        
        return output;
    };

    return self;
};
