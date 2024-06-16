extends Node2D

#region TLDR
# Map Editor is editor that can create (Not Implemented) and load (Not Implemented) maps.
# Also it inherits all functionality of Save Editor

# Make UI so that user can choose between
# "Buttonish" table of map info and
# not interactive one 
# (if list of mods,mechanics and connections
# isn't huge, second should be standard)
#
#endregion


@onready var mapinfo: MapInfo = MapInfo.new()
@onready var map = $Map
@onready var sprite_2d = $Map/Sprite2D
@onready var camera_2d: Camera2D = $Camera2D
@onready var add = $UI/Add
@onready var connect = $UI/Connect

var adding: bool = false
var connecting: bool = false
var dragging: bool = false
var cur_zoom: float = 1
var previous_coords: Vector2
var current_coords: Vector2
var time: int

func _ready():
	#OS.low_processor_usage_mode = false
	sprite_2d.texture = ImageTexture.create_from_image(mapinfo.picture)
	add.toggle_mode = true
	connect.toggle_mode = true

func _process(delta: float):
	time += 1
	if dragging:
		current_coords = get_global_mouse_position()
		if previous_coords.distance_to(current_coords)>9:
			#print(previous_coords, current_coords)
			sprite_2d.position +=  current_coords - previous_coords
			previous_coords = current_coords
			



func _unhandled_input(event):
	if event.is_action_pressed("zoom_in"):
		# Inside a given class, we need to either write `self._zoom_level = ...` or explicitly
		# call the setter function to use it.
		camera_zoom(1.1)
	if event.is_action_pressed("zoom_out"):
		camera_zoom(0.9)
	if event.is_action_pressed("hold"):
		if adding:
			pass
		elif connecting:
			pass
		else:
			previous_coords = get_global_mouse_position()
			dragging = true
	if event.is_action_released("hold"):
		dragging = false
	
	
	

func camera_zoom(delta: float):
	cur_zoom *= delta
	camera_2d.zoom = Vector2(cur_zoom, cur_zoom)
	


func _on_add_pressed():
	adding = !adding
	if adding and connecting:
		connecting = false
		connect.button_pressed = !connect.button_pressed
	#add.action_mode = !add.action_mode


func _on_connect_pressed():
	connecting = !connecting
	if adding and connecting:
		adding = false
		add.button_pressed = !add.button_pressed
	#connect.action_mode = !connect.action_mode
