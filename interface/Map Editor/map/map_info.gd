extends Resource

class_name MapInfo
# Currently is stage 1, so this map will be predertermined object, not well thought basic class

# I will create a lot of unneccessary entities, and then remove some of them (I hope) 
#class Picture:
#	extends Image

@export var picture: Image = Image.load_from_file("res://pictures/map/pic.png")
@export var graphinfo: GraphInfo
#var gameinfo


