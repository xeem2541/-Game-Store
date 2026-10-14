-- โมดูล Decor (ส่วนหนึ่งของ RoadTripBuilder) : ModuleScript ชื่อ Decor
return function(S)
local zoneIndexAt, placeAt, part, vcyl, rand, ROAD_WIDTH, TOTAL, rng, decorF = S.zoneIndexAt, S.placeAt, S.part, S.vcyl, S.rand, S.ROAD_WIDTH, S.TOTAL, S.rng, S.decorF

local cityColors = {
	Color3.fromRGB(120, 130, 150), Color3.fromRGB(90, 100, 120), Color3.fromRGB(150, 150, 160),
	Color3.fromRGB(70, 80, 100), Color3.fromRGB(170, 140, 120),
}

local function building(t, side)
	local w, dep, h = rand(24, 44), rand(24, 40), rand(40, 170)
	local d = side * (ROAD_WIDTH / 2 + 14 + w / 2 + rand(0, 25))
	local cf = placeAt(t, d)
	local b = part(decorF, Vector3.new(w, h, dep), cf * CFrame.new(0, h / 2, 0),
		cityColors[rng:NextInteger(1, #cityColors)], Enum.Material.Concrete)
	b.Name = "Building"
	for k = 1, 4 do
		local band = part(decorF, Vector3.new(0.3, 1.6, dep * 0.9),
			cf * CFrame.new(-side * (w / 2 + 0.1), h * k / 5, 0),
			Color3.fromRGB(255, 230, 150), Enum.Material.Neon)
		band.CanCollide = false
	end
end

local function lamp(t, side, withLight)
	local cf = placeAt(t, side * (ROAD_WIDTH / 2 + 3))
	local pos = cf.Position
	vcyl(decorF, pos, 14, 0.8, Color3.fromRGB(60, 60, 65), Enum.Material.Metal)
	local head = part(decorF, Vector3.new(3, 0.6, 1.4), cf * CFrame.new(-side * 1.2, 14.2, 0),
		Color3.fromRGB(255, 240, 200), Enum.Material.Neon)
	head.CanCollide = false
	if withLight then
		local l = Instance.new("PointLight")
		l.Range = 40
		l.Brightness = 1
		l.Color = Color3.fromRGB(255, 230, 170)
		l.Parent = head
	end
end

local function leafTree(t, side, minD, maxD)
	local d = side * rand(minD, maxD)
	local cf = placeAt(t, d)
	local pos = cf.Position
	if math.abs(pos.Z) > 1000 then
		return
	end
	local h = rand(7, 12)
	vcyl(decorF, pos, h, 2, Color3.fromRGB(110, 75, 45), Enum.Material.Wood)
	local r = rand(10, 16)
	local crown = part(decorF, Vector3.new(r, r, r), CFrame.new(pos + Vector3.new(0, h + r / 3, 0)),
		Color3.fromRGB(60, rng:NextInteger(120, 170), 55), Enum.Material.Grass, Enum.PartType.Ball)
	crown.CanCollide = false
end

local function pine(t, side, minD, maxD, noCollide)
	local d = side * rand(minD, maxD)
	local cf = placeAt(t, d)
	local pos = cf.Position
	if math.abs(pos.Z) > 1000 then
		return
	end
	local s = rand(0.8, 1.6)
	vcyl(decorF, pos, 4 * s, 1.6 * s, Color3.fromRGB(100, 70, 45), Enum.Material.Wood)
	local green = Color3.fromRGB(30, rng:NextInteger(85, 120), 50)
	local y = 4 * s
	local diam = 10 * s
	for _ = 1, 3 do
		local layer = vcyl(decorF, pos + Vector3.new(0, y, 0), 5 * s, diam, green, Enum.Material.Grass)
		layer.CanCollide = false
		y = y + 3.6 * s
		diam = diam * 0.72
	end
end

local function boulder(t, side, minD, maxD)
	local d = side * rand(minD, maxD)
	local cf = placeAt(t, d)
	local s = rand(3, 9)
	part(decorF, Vector3.new(s, s * 0.8, s * 1.2),
		cf * CFrame.new(0, s * 0.3, 0) * CFrame.Angles(rand(-0.4, 0.4), rand(0, 6), rand(-0.4, 0.4)),
		Color3.fromRGB(120, 118, 115), Enum.Material.Slate)
end

local function peak(t, side)
	local d = side * rand(95, 280)
	local cf = placeAt(t, d)
	local pos = cf.Position
	local H = rand(150, 380)
	local D = rand(90, 170)
	local layers = 6
	local lh = H / layers
	local diam = D
	for i = 1, layers do
		local snow = i >= layers - 1
		vcyl(decorF, Vector3.new(pos.X, 0 + (i - 1) * lh, pos.Z), lh, diam,
			snow and Color3.fromRGB(240, 245, 250) or Color3.fromRGB(105, 100, 96),
			snow and Enum.Material.Snow or Enum.Material.Rock)
		diam = diam * 0.74
	end
end

local function palm(t, side)
	local d = side * rand(ROAD_WIDTH / 2 + 6, ROAD_WIDTH / 2 + 45)
	local cf = placeAt(t, d)
	local pos = cf.Position
	if pos.Z > 235 or pos.Z < -600 then
		return
	end
	local h = rand(12, 17)
	vcyl(decorF, pos, h, 1.5, Color3.fromRGB(150, 110, 70), Enum.Material.Wood)
	local top = CFrame.new(pos + Vector3.new(0, h, 0))
	for k = 0, 5 do
		local leaf = part(decorF, Vector3.new(11, 0.4, 3.2),
			top * CFrame.Angles(0, k * math.rad(60), 0) * CFrame.Angles(0, 0, -0.45) * CFrame.new(5, 0, 0),
			Color3.fromRGB(45, 150, 60), Enum.Material.Grass)
		leaf.CanCollide = false
	end
end

local function umbrella(t, side)
	local d = side * rand(ROAD_WIDTH / 2 + 12, ROAD_WIDTH / 2 + 50)
	local cf = placeAt(t, d)
	local pos = cf.Position
	if pos.Z > 235 or pos.Z < -600 then
		return
	end
	vcyl(decorF, pos, 8, 0.4, Color3.fromRGB(240, 240, 240), Enum.Material.Metal)
	local top = vcyl(decorF, pos + Vector3.new(0, 8, 0), 0.6, 11,
		rng:NextNumber() < 0.5 and Color3.fromRGB(235, 60, 60) or Color3.fromRGB(60, 140, 235),
		Enum.Material.Fabric)
	top.CanCollide = false
	part(decorF, Vector3.new(6, 0.5, 2.2), CFrame.new(pos + Vector3.new(4, 0.3, 3)) * CFrame.Angles(0, rand(0, 6), 0),
		Color3.fromRGB(255, 220, 90), Enum.Material.Fabric)
end

local function campfire(pos)
	for k = 0, 2 do
		part(decorF, Vector3.new(0.8, 0.8, 4),
			CFrame.new(pos + Vector3.new(0, 0.5, 0)) * CFrame.Angles(0, k * math.rad(60), 0) * CFrame.Angles(0.35, 0, 0),
			Color3.fromRGB(95, 65, 40), Enum.Material.Wood)
	end
	local core = part(decorF, Vector3.new(2, 1, 2), CFrame.new(pos + Vector3.new(0, 1, 0)),
		Color3.fromRGB(255, 120, 20), Enum.Material.Neon)
	core.CanCollide = false
	local fire = Instance.new("Fire")
	fire.Size = 7
	fire.Heat = 8
	fire.Parent = core
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 160, 80)
	light.Range = 30
	light.Brightness = 2
	light.Parent = core
	for k = 0, 3 do
		local a = k * math.pi / 2
		part(decorF, Vector3.new(5, 1.4, 1.8),
			CFrame.new(pos + Vector3.new(math.cos(a) * 7, 0.7, math.sin(a) * 7)) * CFrame.Angles(0, -a, 0),
			Color3.fromRGB(120, 85, 55), Enum.Material.Wood)
	end
end

local function tent(t, side)
	local d = side * rand(ROAD_WIDTH / 2 + 14, ROAD_WIDTH / 2 + 50)
	local cf = placeAt(t, d)
	local colors = {
		Color3.fromRGB(240, 130, 40), Color3.fromRGB(60, 140, 220),
		Color3.fromRGB(220, 70, 90), Color3.fromRGB(240, 200, 60),
	}
	local c = colors[rng:NextInteger(1, #colors)]
	for _, s in ipairs({ -1, 1 }) do
		part(decorF, Vector3.new(7, 0.4, 10),
			cf * CFrame.new(s * 2.44, 2.51, 0) * CFrame.Angles(0, 0, s * -0.8),
			c, Enum.Material.Fabric)
	end
	-- กองไฟหน้าเต็นท์ (ฝั่งที่หันเข้าหาถนน)
	campfire(cf.Position + cf.RightVector * (-side * 14))
end

for t = 30, TOTAL - 30, 30 do
	if (t / 30) % 10 == 0 then
		task.wait()
	end
	local zi = zoneIndexAt(t)
	for _, side in ipairs({ -1, 1 }) do
		if zi == 1 then
			if t % 60 == 0 then
				building(t, side)
			end
			if t % 60 == 30 and side == (t % 120 == 30 and 1 or -1) then
				lamp(t, side, t % 120 == 30)
			end
		elseif zi == 2 then
			if rng:NextNumber() < 0.7 then
				leafTree(t, side, ROAD_WIDTH / 2 + 10, ROAD_WIDTH / 2 + 150)
			end
			if rng:NextNumber() < 0.12 then
				boulder(t, side, ROAD_WIDTH / 2 + 8, ROAD_WIDTH / 2 + 100)
			end
		elseif zi == 3 then
			if t % 90 == 0 then
				peak(t, side)
			end
			if rng:NextNumber() < 0.5 then
				pine(t, side, ROAD_WIDTH / 2 + 3, 32)
			end
			if rng:NextNumber() < 0.2 then
				boulder(t, side, ROAD_WIDTH / 2 + 3, 30)
			end
		elseif zi == 4 then
			if rng:NextNumber() < 0.5 then
				palm(t, side)
			end
			if rng:NextNumber() < 0.12 then
				umbrella(t, side)
			end
			if rng:NextNumber() < 0.08 then
				boulder(t, side, ROAD_WIDTH / 2 + 8, ROAD_WIDTH / 2 + 80)
			end
		else
			if rng:NextNumber() < 0.8 then
				pine(t, side, ROAD_WIDTH / 2 + 8, ROAD_WIDTH / 2 + 160)
			end
			if t % 150 == 0 and side == 1 then
				tent(t, side)
			end
		end
	end
end


S.building = building
S.lamp = lamp
S.leafTree = leafTree
S.pine = pine
S.boulder = boulder
S.peak = peak
S.palm = palm
S.umbrella = umbrella
S.campfire = campfire
S.tent = tent
S.cityColors = cityColors
end
