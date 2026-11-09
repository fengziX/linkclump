var config = {
	"triggers": 
		[{"name": "左键"}, {"name": "中键"}, {"name": "右键"}],
	"actions": {
		"win": {"name": "在新窗口打开", "options": ["smart", "ignore", "delay", "block", "reverse", "unfocus"]},
		"tabs": {"name": "在新标签页打开", "options": ["smart", "ignore", "delay", "close", "block", "reverse", "end"]},
		"bm": {"name": "加入书签", "options": ["smart", "ignore", "block", "reverse"]},
		"copy": {"name": "复制到剪贴板", "options": ["smart", "ignore", "copy", "block", "reverse"]}
	},
	"options": {
		"smart": {
			"name": "智能选择",
			"type": "selection", 
			"data": ["开启", "关闭"],
			"extra": "开启后 Linkclump 会尽量只选中重要链接（标题类链接）"
		},
	"ignore": {
		"name": "链接过滤",
		"type": "selection-textbox",
		"data": ["排除含这些词的链接", "只包含含这些词的链接"],
		"extra": "按关键词过滤链接；多个词用英文逗号 , 分隔"
		},
	"copy": {
		"name": "复制格式",
		"type": "selection",
		"data": ["网址 + 标题", "仅网址", "仅网址（空格分隔）", "仅标题", "链接 HTML", "列表链接 HTML", "Markdown"],
		"extra": "复制到剪贴板时使用的格式"
		},
	"delay": {
		"name": "打开间隔",
		"type": "textbox",
		"extra":"每个链接之间间隔的秒数"
		},
	"close": {
		"name": "自动关闭标签",
		"type": "textbox",
		"extra":"打开后多少秒自动关闭标签（0 表示不关闭）"
		},
	"block": {
		"name": "去除重复链接",
		"type": "checkbox",
		"extra":"勾选后同一网址只处理一次"
		},
	"reverse": {
		"name": "倒序打开",
		"type": "checkbox",
		"extra":"勾选后按相反顺序处理链接"
		},
	"end": {
		"name": "在末尾打开标签",
		"type": "checkbox",
		"extra": "勾选后新标签排在所有标签最后"
		},
	"unfocus": {
		"name": "不聚焦新窗口",
		"type": "checkbox",
		"extra": "勾选后新窗口不会切到前台"
		}
	}
};

var OS_WIN = 0;
var OS_LINUX = 1;
var OS_MAC = 2;

var colors = ["458B74", "838B8B", "CCCCCC", "0000FF", "8A2BE2", "D2691E", "6495ED", "DC143C", "006400", "9400D3", "1E90FF", "228B22", "00FF00", "ADFF2F", "FF69B4", "4B0082", "F0E68C", "8B814C", "87CEFA", "32CD32", "000080", "FFA500", "FF4500", "DA70D6", "8B475D", "8B668B", "FF0000", "2E8B57", "8E388E", "FFFF00"];
var params = null;
var div_history = [];
var keys = displayKeys(0);
var os = ((navigator.appVersion.indexOf("Win") === -1) ? ((navigator.appVersion.indexOf("Mac") === -1) ? OS_LINUX : OS_MAC) : OS_WIN);

function close_form(event) {
	$("#form-background").fadeOut();

	event.preventDefault();
}

function tour1() {
	setup_text(keys);
	$("#page2").fadeOut(0);
	$("#page1").fadeIn();
	$("#test_area").focus();
}

function tour2() {
	$("#page1").fadeOut(0);
	$("#page2").fadeIn();
}

function load_action(id) {  // into form

    if(id === null) {
        displayKeys(0);
        displayOptions("tabs");
        $("#form_id").val("");
        $("#form_mouse").val(0);  // default to left mouse button
        $("#form_key").val(90);   // and z key
        $(".colorpicker-trigger").css("background-color", "#"+colors[Math.floor(Math.random()*colors.length)]);
    } else {
        var param = params.actions[id];
        $("#form_id").val(id);

        $("#form_mouse").val(param.mouse);
        displayKeys(param.mouse);
        $("#form_key").val(param.key);

        $(".colorpicker-trigger").css("background-color", param.color);

        $("#form_"+param.action).attr("checked","checked");

        displayOptions(param.action);

        for(var i in param.options) {
            switch(config.options[i].type) {
                case "selection":
                    $("#form_option_"+i).val(param.options[i]);
                    break;

                case "textbox":
                    $("#form_option_"+i).val(param.options[i]);
                    break;

                case "checkbox":
                    if(param.options[i]) {
                        $("#form_option_"+i).attr("checked", true);
                    } else {
                        $("#form_option_"+i).attr("checked", false);
                    }
                    break;

                case "selection-textbox":
                    if(param.options[i].length > 1) {
                        var selection = param.options[i][0];
                        var text = "";
                        for(var k = 1; k < param.options[i].length; k++) {
                            text += param.options[i][k]+",";
                        }

                        $("#form_option_selection_"+i).val(selection);
                        $("#form_option_text_"+i).val(text);
                    }

                    break;
            }

        }
    }

    // hide warning and let it show later if required
    $(".warning").hide();

    // place the form at the top of the window+10
    $(".form").css("margin-top", $(window).scrollTop()+10);

    // fade in the form and set the background to cover the whole page
    $("#form-background").fadeIn();
    $("#form-background").css("height", $(document).height());

    check_selection();
}

function delete_action(id, div) {
    div.fadeOut("swing", function(){
        var del = $("<div class='undo'>已删除该动作 </div>");
        var undo = $("<a>撤销</a>").click({"i":id, "param":params.actions[id]},
            function(event) {
                div_history[event.data.i].replaceWith(setup_action(event.data.param, event.data.i));
                params.actions[event.data.i] = event.data.param;

                delete(div_history[event.data.i]);

                save_params();
                return false;
            }
        );
        del.append(undo);

        $(this).replaceWith(del).fadeIn("swing");

        div_history[id] = del;
        delete(params.actions[id]);

        save_params();
    });
}

function setup_action(param, id) {
	var setting = $("<div class='setting' id='action_"+id+"'>");

	setting.append("<h3>"+config.actions[param.action].name+"</h3>");
	setting.append("触发方式：" + config.triggers[param.mouse].name + "鼠标按钮");
	if(param.key > 0) {
		setting.append(" + 「" + keys[param.key] + "」键");
	}

	var list = $("<ul>");
	for(var j in param.options) {
		var op = config.options[j];
		var text = op.name+": ";
		switch(op.type) {
		case "selection":
			text += op.data[param.options[j]];
			break;
		case "textbox":
			// TODO not sure if param.options[j] returns a string or int
			if(param.options[j] === "" || param.options[j] == "0") {
				continue;
			}
			text += param.options[j];
			break;
		case "checkbox":
			if(!param.options[j]) {
				continue;
			}
			text += param.options[j];
			break;
		case "selection-textbox":
			if(param.options[j].length < 2) {
				continue;
			}
			var selection = param.options[j][0];
			var words = "";
			for(var i = 1; i < param.options[j].length; i++) {
				words += param.options[j][i];
				
				if(i < param.options[j].length-1) {
					words += ", ";
				}
			}
			text += op.data[selection]+"; "+words;
			break;
		}

		list.append("<li>"+text+"</li>");
	}
	list.append("<li>选框颜色：<div style='background-color: "+param.color+"' class='color'></div></li>");

	setting.append(list);

	var edit = $("<a href='#' class='button edit'>编辑</a>").click({'i':id},
		function(event) {
			load_action(event.data.i, $(this).parent().parent());
			return false;
		}
	);

	var del = $("<a href='#' class='button delete'>删除</a>").click({"i":id},
		function(event) {
			delete_action(event.data.i, $(this).parent());
			return false;
		}
	);

	setting.append(del);
	setting.append(edit);

	return setting;
}

function setup_form() {
	var mouse = $("#form_mouse");
	for(var i = 0; i < config.triggers.length; i++) {
		mouse.append('<option value="'+i+'">'+config.triggers[i].name+'</option>');
	}

	mouse.change(function(event) {
        displayKeys($(this)[0][$(this)[0].selectedIndex].value);
		check_selection();
	});

	var color = $("#form_color");
	for(var i in colors) {
		color.append("<option value='"+colors[i]+"'>"+colors[i]+"</option>");
	}

	color.colorpicker({
		size: 30,
		hide: false
	});


	var action = $("#form_action");
	for(var i in config.actions) {
		var act = $('<input type="radio" name="action" value="'+i+'" id="form_'+i+'"/>'+config.actions[i].name+'<br/>')


		act.click(function(event) {
			displayOptions(event.currentTarget.value)
		}
		);

		action.append(act);
	}

	$('input[value="tabs"]').attr("checked", "checked");
}

function setup_text(keys) {
	var param;
	for(var i in params.actions) {
		param = params.actions[i];
		break;
	}
	if(param === undefined) {
		return;
	}
	$("#mouse_name").text(config.triggers[param.mouse].name);
	$("#action_name").text(config.actions[param.action].name);
	if(param.key > 0) {
		$("#key_name").html("<b>"+keys[param.key]+"</b> 键 + ");
	} else {
		$("#key_name").html("");
	}
}

function check_selection() {
	var m = $("#form_mouse").val();
	var k = $("#form_key").val();
	var id = $("#form_id").val();


    var keyWarning = $('#key_warning');
    keyWarning.empty();
	if (k === "0") {
        keyWarning.append("⚠️ 不设置按键可能在某些网站上误触发");
        if($(".warning2").is(":hidden")) {
            $(".warning2").fadeIn();
        }
	} else {
        if(!$(".warning2").is(":hidden")) {
            $(".warning2").fadeOut();
        }
	}

	for(var i in params.actions) {
	    // not sure if mouse/key are strings or ints
		if(i != id && params.actions[i].mouse == m && params.actions[i].key == k) {
			if($(".warning").is(":hidden")) {
				$(".warning").fadeIn();
			}

			return;
		}
	}
	
	if(!$(".warning").is(":hidden")) {
		$(".warning").fadeOut();
	}
}

function displayOptions(action) {
	var options = $("#form_options");
	options.empty();

	for(var i in config.actions[action].options) {
		var op = config.options[config.actions[action].options[i]];
		var title = $("<label>"+op.name+"</label>");
		var p = $("<p />");
		p.append(title);

		switch(op.type) {
		case "selection":
			var selector = $("<select id='form_option_"+config.actions[action].options[i]+"'>");
			for(var j in op.data) {
				selector.append('<option value="'+j+'">'+op.data[j]+'</option>');
			}
			p.append(selector);
			break;

		case "textbox":
			p.append('<input type="text" name="'+op.name+'" id="form_option_'+config.actions[action].options[i]+'"/>');
			break;

		case "checkbox":
			p.append('<input type="checkbox" name="'+op.name+'" id="form_option_'+config.actions[action].options[i]+'"/>');
			break;
			
		case "selection-textbox":
			var selector = $("<select id='form_option_selection_"+config.actions[action].options[i]+"'>");
			for(var j in op.data) {
				selector.append('<option value="'+j+'">'+op.data[j]+'</option>');
			}
			p.append(selector);
			p.append('</p><label> </label><p>');
			p.append('<input type="text" name="'+op.name+'" id="form_option_text_'+config.actions[action].options[i]+'"/>');
			break;
		}

		p.mouseover({"extra":op.extra}, function(event) {
			var extra = $("#form_extra");
			extra.html(event.data.extra);
			extra.css("top", $(this).position().top);
			extra.css("left", $(this).position().left+500);
			extra.show();
		}).mouseout(function() {
			$("#form_extra").hide();
		});

		options.append(p);

	}
}

function displayKeys(mouseButton) {
	var key = $("#form_key");
	key.empty();
	var keys = [];

	keys[16] = "shift";
	keys[17] = "ctrl";

	if (os !== OS_LINUX) {
		keys[18] = "alt";
	}

    // if not left or windows then allow no key
    // NOTE mouseButton is sometimes a string, sometimes an int
    if(mouseButton != 2 || os === OS_WIN) {
        keys[0] = '';
    }

	// add on alpha characters
	for (var i = 0; i < 26; i++) {
		keys[65+i] = String.fromCharCode(97 + i);
	}

	for(var i in keys) {
		key.append('<option value="'+i+'">'+keys[i]+'</option>');
	}

	// set selected value to z
    key.val(90);

	return keys;
}

function load_new_action(event) {
	load_action(null);
	event.preventDefault();
}

function save_action(event) {
	var id = $("#form_id").val();

	var param = {};

	param.mouse = $("#form_mouse").val();
	param.key = $("#form_key").val();
	param.color = $(".colorpicker-trigger").css("background-color");
	param.action = $("input[name=action]:radio:checked").val();
	param.options = {};

	for(var opt in config.actions[param.action].options) {
		var name = config.actions[param.action].options[opt];
		var type = config.options[name].type;
		if(type === "checkbox") {
			param.options[name] = $("#form_option_"+name).is(":checked");
		} else {
			if(name === "ignore") {
				var ignore = $("#form_option_text_"+name).val().replace(/^ */, "").replace(/, */g, ",").toLowerCase().split(",")
				// if the last entry is empty then just remove from array
				if (ignore.length > 0 && ignore[ignore.length-1] === "") {
					ignore.pop();
				}
				// add selection to the start of the array
				ignore.unshift(param.options[name] = $("#form_option_selection_"+name).val());
				
				param.options[name] = ignore;
			} else if(name === "delay" || name === "close") {
				var delay;
				try {
					delay = parseFloat($("#form_option_"+name).val());
				} catch(err) {
					delay = 0;
				}
				if(isNaN(delay)) {
					delay = 0;
				}


				param.options[name] = delay;
			} else {
				param.options[name] = $("#form_option_"+name).val();
			}
		}
	}

	if(id === "" || params.actions[id] === null) {
		var newDate = new Date;
		id = newDate.getTime();

		params.actions[id] = param;
		$("#settings").append(setup_action(param, id));
	} else {
		params.actions[id] = param;
		var update = setup_action(param, id);
		$("#action_"+id).replaceWith(update);
	}

	save_params();
	close_form(event);
}

function save_params() {
	chrome.runtime.sendMessage({
		message: "update",
		settings: params
	}).catch(function (error) {
		console.log("[Linkclump] 保存设置失败：" + error);
	});
}

function save_block() {
	// 去掉首尾空白，避免产生空的站点条目
	var sites = $("#form_block").val().replace(/^\s+|\s+$/g, "").split("\n");
	
	if (Array.isArray(sites)) {
		params.blocked = sites;
		save_params();
	}
}

function show_visited_status(text) {
	var status = $("#visited_status").text(text).stop(true, true).fadeIn();
	setTimeout(function () { status.fadeOut(); }, 1800);
}

var DEFAULT_VISITED_COLOR = "#551A8B";

function load_visited() {
	var v = params.visited || { enabled: true, color: DEFAULT_VISITED_COLOR, autoColor: false, auto: false };
	$("#visited_enabled").prop("checked", v.enabled !== false);
	$("#visited_color").val(v.color || DEFAULT_VISITED_COLOR);
	$("#visited_auto_color").prop("checked", v.autoColor === true);
	$("#visited_auto").prop("checked", v.auto === true);
}

function save_visited() {
	var color = $.trim($("#visited_color").val() || "") || DEFAULT_VISITED_COLOR;
	$("#visited_color").val(color);
	params.visited = {
		enabled: $("#visited_enabled").is(":checked"),
		color: color,
		autoColor: $("#visited_auto_color").is(":checked"),
		auto: $("#visited_auto").is(":checked")
	};
	save_params();
	show_visited_status("已保存");
}

function clear_visited(event) {
	chrome.runtime.sendMessage({ message: "clearVisited" }).then(function () {
		show_visited_status("已清除所有已访问标记");
	}).catch(function (error) {
		show_visited_status("清除失败：" + error);
	});
	event.preventDefault();
}

$(function() {
	var isFirstTime = window.location.href.indexOf("init=true") > -1;

	// 测试模式下不加载
	if (document.getElementById("guide2") === null) {
		return
	}


	document.getElementById("guide2").addEventListener("click", tour2);
	document.getElementById("guide1").addEventListener("click", tour1);
	document.getElementById("add").addEventListener("click", load_new_action);
	document.getElementById("form_block").addEventListener("keyup", save_block);
	document.getElementById("form_key").addEventListener("change", check_selection);
	document.getElementById("cancel").addEventListener("click", close_form);
	document.getElementById("save").addEventListener("click", save_action);
	$("#visited_enabled").on("change", save_visited);
	$("#visited_color").on("change", save_visited);
	$("#visited_auto_color").on("change", save_visited);
	$("#visited_auto").on("change", save_visited);
	$("#visited_clear").on("click", clear_visited);

	setup_form();

	chrome.runtime.sendMessage({
		message: "init"
	}).then(function(response){
		params = response;
		if (!params.visited) {
			params.visited = { enabled: true, color: DEFAULT_VISITED_COLOR, autoColor: false, auto: false };
		}

		for(var i in params.actions) {
			$("#settings").append(setup_action(params.actions[i], i));
		}
		setup_text(keys);

		$("#form_block").val((params.blocked || []).join("\n"));
		load_visited();

		if(isFirstTime) {
			tour1();
		} else {
			tour2();
		}
	}).catch(function (error) {
		console.log("[Linkclump] 读取设置失败：" + error);
	});
});
