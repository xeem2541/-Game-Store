--[[
	Road Trip Racing  (รถซิ่งเที่ยวทริป)
	ServerScript -> วางใน ServerScriptService

	เมื่อกด Play สคริปต์นี้จะสร้างทั้งแมพให้เอง:
	  * ถนนยาว ~6,000 studs ผ่าน 5 โซน: เมือง -> ทุ่งหญ้า -> ภูเขา -> ชายหาด -> แคมป์
	  * จุดเสกรถ (แผ่นสีเขียว) ที่จุดเริ่มต้นและข้างเช็คพอยต์ทุกจุด
	  * แผ่นบูสต์ (สีฟ้า)
	  * เช็คพอยต์ 9 จุด + เส้นชัย (ตายแล้วเกิดที่เช็คพอยต์ล่าสุด)
	ปรับค่าได้ที่หัวไฟล์ (CONFIG)
]]

local Workspace = game:GetService("Workspace")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Lighting = game:GetService("Lighting")
local StarterGui = game:GetService("StarterGui")

print("[RoadTrip] สคริปต์เริ่มทำงาน กำลังสร้างแมพ... (รอสักครู่)")

local function reportError(err)
	warn("[RoadTrip] เกิดข้อผิดพลาด: " .. tostring(err))
	local function addGui(parent)
		local g = Instance.new("ScreenGui")
		g.Name = "RoadTripError"
		g.ResetOnSpawn = false
		local l = Instance.new("TextLabel")
		l.Size = UDim2.new(1, -40, 0, 160)
		l.Position = UDim2.new(0, 20, 1, -180)
		l.BackgroundColor3 = Color3.fromRGB(120, 0, 0)
		l.TextColor3 = Color3.new(1, 1, 1)
		l.TextWrapped = true
		l.TextScaled = true
		l.Text = "RoadTrip ERROR: " .. tostring(err)
		l.Parent = g
		g.Parent = parent
	end
	addGui(StarterGui)
	for _, pl in ipairs(game:GetService("Players"):GetPlayers()) do
		local pg = pl:FindFirstChildOfClass("PlayerGui")
		if pg then
			addGui(pg)
		end
	end
end

local ok, err = xpcall(function()

----------------------------------------------------------------------
-- CONFIG
----------------------------------------------------------------------
local ZONE_LENGTH = 1200 -- ความยาวต่อโซน (studs)
local STEP = 12 -- ความละเอียดของถนน (เล็ก = เนียนกว่า แต่ part เยอะกว่า)
local ROAD_WIDTH = 36
local CHECKPOINT_EVERY = 600
local BOOST_EVERY = 400

local CAR_MAX_SPEED = 130 -- studs/s (~36 km/h ต่อ 10 studs/s = 0.28 m/s)
local BOOST_MULT = 1.7
local BOOST_TIME = 3
local WHEEL_RADIUS = 1.5
local DRIVE_SIGN = 1 -- ถ้ารถวิ่งถอยหลังตอนกด W ให้เปลี่ยนเป็น -1
local STEER_SIGN = 1 -- ถ้าเลี้ยวผิดข้างให้เปลี่ยนเป็น -1

local ZONES = {
	{
		name = "City", thai = "เมือง",
		ground = Color3.fromRGB(105, 105, 110), groundMat = Enum.Material.Concrete,
		road = Color3.fromRGB(45, 45, 50), roadMat = Enum.Material.Asphalt,
		accent = Color3.fromRGB(255, 80, 200), lines = true, rails = false,
	},
	{
		name = "Grassland", thai = "ทุ่งหญ้า",
		ground = Color3.fromRGB(86, 150, 60), groundMat = Enum.Material.Grass,
		road = Color3.fromRGB(55, 55, 58), roadMat = Enum.Material.Asphalt,
		accent = Color3.fromRGB(120, 255, 100), lines = true, rails = false,
	},
	{
		name = "Mountain", thai = "ภูเขา",
		ground = Color3.fromRGB(112, 108, 104), groundMat = Enum.Material.Slate,
		road = Color3.fromRGB(60, 60, 65), roadMat = Enum.Material.Asphalt,
		accent = Color3.fromRGB(120, 200, 255), lines = true, rails = true,
	},
	{
		name = "Beach", thai = "ชายหาด",
		ground = Color3.fromRGB(238, 214, 160), groundMat = Enum.Material.Sand,
		road = Color3.fromRGB(95, 95, 100), roadMat = Enum.Material.Concrete,
		accent = Color3.fromRGB(255, 200, 60), lines = true, rails = true,
	},
	{
		name = "Camp", thai = "แคมป์",
		ground = Color3.fromRGB(70, 112, 50), groundMat = Enum.Material.Grass,
		road = Color3.fromRGB(122, 92, 62), roadMat = Enum.Material.Ground,
		accent = Color3.fromRGB(255, 140, 40), lines = false, rails = false,
	},
}

local TOTAL = ZONE_LENGTH * #ZONES
local rng = Random.new(2024)

----------------------------------------------------------------------
-- เส้นทางถนน
----------------------------------------------------------------------
local function zoneIndexAt(t)
	return math.clamp(math.floor(t / ZONE_LENGTH) + 1, 1, #ZONES)
end

local function heightAt(t)
	local zi = math.floor(t / ZONE_LENGTH)
	local u = (t - zi * ZONE_LENGTH) / ZONE_LENGTH
	if zi == 1 then -- ทุ่งหญ้า: เนินสลับขึ้นลงเบา ๆ
		return 8 * math.sin(math.pi * u) * math.sin(u * math.pi * 6)
	elseif zi == 2 then -- ภูเขา: ไต่ขึ้นแล้วลง
		return 140 * math.sin(math.pi * u) ^ 2
	end
	return 0
end

local function lateralAt(t)
	return 90 * math.sin(t / 500) + 40 * math.sin(t / 260)
end

local function pointAt(t)
	return Vector3.new(t, heightAt(t) + 0.5, lateralAt(t))
end

-- CFrame ที่กึ่งกลางถนน (ผิวถนน) หันไปตามทิศถนน (หมุนเฉพาะแกน Y), offset ด้านข้างได้
local function frame(t, lateral)
	local d = pointAt(t + 1) - pointAt(math.max(t - 1, 0))
	local yaw = math.atan2(-d.X, -d.Z)
	return CFrame.new(pointAt(t)) * CFrame.Angles(0, yaw, 0) * CFrame.new(lateral or 0, 0, 0)
end

-- ความสูงพื้นที่ข้างถนน (ไหล่ทางยกตามถนน, ไกลออกไปเป็นพื้นราบ)
local function baseY(t, lateral)
	if math.abs(lateral) < 34 then
		return math.max(0, pointAt(t).Y - 1.1)
	end
	return 0
end

local function placeAt(t, lateral)
	local f = frame(t, lateral)
	return CFrame.new(f.X, baseY(t, lateral), f.Z) * f.Rotation
end

----------------------------------------------------------------------
-- ตัวช่วยสร้าง Part
----------------------------------------------------------------------
local function part(parent, size, cf, color, material, shape)
	local p = Instance.new("Part")
	p.Anchored = true
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Material = material or Enum.Material.SmoothPlastic
	if shape then
		p.Shape = shape
	end
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

-- ทรงกระบอกตั้งตรง ฐานอยู่ที่ pos
local function vcyl(parent, pos, height, diameter, color, material)
	return part(
		parent,
		Vector3.new(height, diameter, diameter),
		CFrame.new(pos + Vector3.new(0, height / 2, 0)) * CFrame.Angles(0, 0, math.pi / 2),
		color, material, Enum.PartType.Cylinder
	)
end

local function rand(a, b)
	return rng:NextNumber(a, b)
end

----------------------------------------------------------------------
-- โครงสร้างโลก
----------------------------------------------------------------------
local old = Workspace:FindFirstChild("RoadTripWorld")
if old then
	old:Destroy()
end

local world = Instance.new("Folder")
world.Name = "RoadTripWorld"
world.Parent = Workspace

local function folder(name)
	local f = Instance.new("Folder")
	f.Name = name
	f.Parent = world
	return f
end

local groundF = folder("Ground")
local roadF = folder("Road")
local gatesF = folder("Checkpoints")
local boostF = folder("BoostPads")
local padsF = folder("CarSpawnPads")
local decorF = folder("Decor")
local carsF = folder("Cars")

-- บรรยากาศ
Lighting.ClockTime = 14.5
Lighting.Brightness = 3
Lighting.Ambient = Color3.fromRGB(110, 110, 120)
if not Lighting:FindFirstChildOfClass("Atmosphere") then
	local atm = Instance.new("Atmosphere")
	atm.Density = 0.25
	atm.Offset = 0.25
	atm.Color = Color3.fromRGB(199, 215, 235)
	atm.Parent = Lighting
end

----------------------------------------------------------------------
-- พื้นแต่ละโซน
----------------------------------------------------------------------
for i, z in ipairs(ZONES) do
	local x0 = (i - 1) * ZONE_LENGTH
	local cx = x0 + ZONE_LENGTH / 2
	if z.name == "Beach" then
		-- ทรายฝั่งในแผ่นดิน + น้ำทะเลฝั่ง +Z
		part(groundF, Vector3.new(ZONE_LENGTH + 4, 6, 1160), CFrame.new(cx, -3, -320), z.ground, z.groundMat)
		local water = part(groundF, Vector3.new(ZONE_LENGTH + 4, 7.4, 740), CFrame.new(cx, -4.3, 630),
			Color3.fromRGB(40, 150, 220), Enum.Material.Glass)
		water.Transparency = 0.35
		water.CanCollide = false
		part(groundF, Vector3.new(ZONE_LENGTH + 4, 2, 740), CFrame.new(cx, -9, 630),
			Color3.fromRGB(230, 205, 150), Enum.Material.Sand)
	else
		part(groundF, Vector3.new(ZONE_LENGTH + 4, 6, 1800), CFrame.new(cx, -3, 0), z.ground, z.groundMat)
	end
end

----------------------------------------------------------------------
-- ถนน
----------------------------------------------------------------------
for t = 0, TOTAL - STEP, STEP do
	if (t / STEP) % 25 == 0 then
		task.wait()
	end
	local a, b = pointAt(t), pointAt(t + STEP)
	local zone = ZONES[zoneIndexAt(t + STEP / 2)]
	local mid = (a + b) / 2
	local len = (b - a).Magnitude
	local cf = CFrame.lookAt(mid, b)

	part(roadF, Vector3.new(ROAD_WIDTH, 1.2, len + 0.6), cf * CFrame.new(0, -0.6, 0), zone.road, zone.roadMat)

	-- ไหล่ทาง/ฐานถนนที่ยกสูงตามเนิน
	local slab = part(roadF, Vector3.new(70, 3, len + 0.6), cf * CFrame.new(0, -2.6, 0), zone.ground, zone.groundMat)
	if zone.name == "Mountain" then
		slab.Color = Color3.fromRGB(100, 96, 92)
		slab.Material = Enum.Material.Rock
	end
	local colH = mid.Y - 3.5
	if colH > 2 then
		local flat = CFrame.lookAt(Vector3.new(mid.X, 0, mid.Z), Vector3.new(b.X, 0, b.Z))
		part(roadF, Vector3.new(28, colH, len + 0.6), flat * CFrame.new(0, colH / 2, 0),
			Color3.fromRGB(95, 92, 88), Enum.Material.Rock)
	end

	if zone.lines then
		-- เส้นขอบถนน
		for _, s in ipairs({ -1, 1 }) do
			part(roadF, Vector3.new(0.6, 0.12, len + 0.6), cf * CFrame.new(s * (ROAD_WIDTH / 2 - 1.2), 0.04, 0),
				Color3.fromRGB(240, 240, 240), Enum.Material.SmoothPlastic).CanCollide = false
		end
		-- เส้นประกลางถนน
		if (t / STEP) % 2 == 0 then
			part(roadF, Vector3.new(0.8, 0.12, len * 0.9), cf * CFrame.new(0, 0.04, 0),
				Color3.fromRGB(255, 220, 60), Enum.Material.SmoothPlastic).CanCollide = false
		end
	end

	if zone.rails then
		for _, s in ipairs({ -1, 1 }) do
			part(roadF, Vector3.new(0.7, 1.8, len + 0.6), cf * CFrame.new(s * (ROAD_WIDTH / 2 + 0.5), 0.9, 0),
				Color3.fromRGB(200, 200, 205), Enum.Material.Metal)
		end
	end
end

----------------------------------------------------------------------
-- แผนที่เริ่มต้น (ลานจอด + จุดเกิดผู้เล่น)
----------------------------------------------------------------------
local startFrame = frame(0)
local plaza = part(roadF, Vector3.new(130, 1, 120), startFrame * CFrame.new(0, -0.7, 65),
	Color3.fromRGB(70, 70, 76), Enum.Material.Concrete)
plaza.Name = "StartPlaza"

local spawn = Instance.new("SpawnLocation")
spawn.Name = "RoadTripSpawn"
spawn.Anchored = true
spawn.Neutral = true
spawn.Duration = 0
spawn.Size = Vector3.new(10, 1, 10)
spawn.CFrame = startFrame * CFrame.new(-30, 0.1, 50)
spawn.Color = Color3.fromRGB(255, 255, 255)
spawn.Transparency = 0.2
spawn.Parent = world

----------------------------------------------------------------------
-- เช็คพอยต์
----------------------------------------------------------------------
local checkpoints = {} -- [i] = { cf = CFrame ที่เกิด, zone = index โซน }
checkpoints[0] = { cf = frame(20) * CFrame.new(0, 3.2, 0), zone = 1 }

local playerState = {} -- [player] = { progress = n }
local cars = {} -- [player] = car record

local function playerFromPart(hit)
	local model = hit:FindFirstAncestorOfClass("Model")
	if not model then
		return nil
	end
	local uid = model:GetAttribute("OwnerUserId")
	if uid then
		return Players:GetPlayerByUserId(uid)
	end
	return Players:GetPlayerFromCharacter(model)
end

local function setProgress(player, idx)
	local st = playerState[player]
	if not st then
		return
	end
	st.progress = idx
	local cp = checkpoints[idx]
	local zone = ZONES[cp.zone]
	player:SetAttribute("Zone", zone.name)
	player:SetAttribute("ZoneThai", zone.thai)
	player:SetAttribute("Checkpoint", idx)
	local ls = player:FindFirstChild("leaderstats")
	if ls and ls:FindFirstChild("Checkpoint") then
		ls.Checkpoint.Value = idx
	end
end

local function makeGateSign(parent, text, size, cf, accent)
	local sign = part(parent, size, cf, Color3.fromRGB(25, 25, 30), Enum.Material.SmoothPlastic)
	for _, face in ipairs({ Enum.NormalId.Front, Enum.NormalId.Back }) do
		local gui = Instance.new("SurfaceGui")
		gui.Face = face
		gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
		gui.PixelsPerStud = 30
		gui.Parent = sign
		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.TextScaled = true
		label.Font = Enum.Font.GothamBold
		label.Text = text
		label.TextColor3 = accent
		label.Parent = gui
	end
	return sign
end

local function buildGate(t, label, accent, onTouch)
	local base = frame(t)
	local half = ROAD_WIDTH / 2 + 2.5
	for _, s in ipairs({ -1, 1 }) do
		part(gatesF, Vector3.new(2.5, 18, 2.5), base * CFrame.new(s * half, 8, 0),
			Color3.fromRGB(235, 235, 240), Enum.Material.Metal)
	end
	part(gatesF, Vector3.new(half * 2 + 2.5, 3, 3), base * CFrame.new(0, 17.5, 0),
		Color3.fromRGB(235, 235, 240), Enum.Material.Metal)
	part(gatesF, Vector3.new(half * 2, 0.5, 0.5), base * CFrame.new(0, 15.7, 0), accent, Enum.Material.Neon)
	makeGateSign(gatesF, label, Vector3.new(half * 1.5, 6, 0.6), base * CFrame.new(0, 22, 0), accent)

	local trigger = part(gatesF, Vector3.new(ROAD_WIDTH + 6, 26, 4), base * CFrame.new(0, 13, 0),
		accent, Enum.Material.SmoothPlastic)
	trigger.Transparency = 1
	trigger.CanCollide = false
	trigger.Name = "Trigger"
	trigger.Touched:Connect(function(hit)
		local player = playerFromPart(hit)
		if player then
			onTouch(player)
		end
	end)
end

----------------------------------------------------------------------
-- จุดเสกรถ
----------------------------------------------------------------------
local spawnCar -- forward declaration

local function buildSpawnPad(cf, labelText)
	local pad = part(padsF, Vector3.new(10, 0.5, 10), cf, Color3.fromRGB(60, 255, 120), Enum.Material.Neon)
	pad.Name = "CarSpawnPad"
	local ring = part(padsF, Vector3.new(11, 0.3, 11), cf * CFrame.new(0, -0.1, 0), Color3.fromRGB(20, 20, 25),
		Enum.Material.Metal)
	ring.CanCollide = false

	local board = Instance.new("BillboardGui")
	board.Size = UDim2.fromOffset(180, 40)
	board.StudsOffset = Vector3.new(0, 4, 0)
	board.AlwaysOnTop = false
	board.MaxDistance = 120
	board.Parent = pad
	local lbl = Instance.new("TextLabel")
	lbl.Size = UDim2.fromScale(1, 1)
	lbl.BackgroundTransparency = 1
	lbl.TextScaled = true
	lbl.Font = Enum.Font.GothamBold
	lbl.TextColor3 = Color3.fromRGB(255, 255, 255)
	lbl.TextStrokeTransparency = 0.3
	lbl.Text = labelText
	lbl.Parent = board

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "เสกรถ"
	prompt.ObjectText = "Spawn Car"
	prompt.HoldDuration = 0.25
	prompt.MaxActivationDistance = 14
	prompt.RequiresLineOfSight = false
	prompt.Parent = pad
	prompt.Triggered:Connect(function(player)
		spawnCar(player)
	end)
end

buildSpawnPad(startFrame * CFrame.new(10, 0.1, 50), "🚗 เสกรถที่นี่")

----------------------------------------------------------------------
-- สร้างเช็คพอยต์ + เส้นชัย
----------------------------------------------------------------------
local cpCount = 0
for t = CHECKPOINT_EVERY, TOTAL - 1, CHECKPOINT_EVERY do
	if t < TOTAL - 100 then
		cpCount = cpCount + 1
	end
end
local FINISH_INDEX = cpCount + 1

do
	local idx = 0
	for t = CHECKPOINT_EVERY, TOTAL - 100, CHECKPOINT_EVERY do
		idx = idx + 1
		local myIdx = idx
		local zi = zoneIndexAt(t + 1)
		local isZoneStart = (t % ZONE_LENGTH == 0)
		local zone = ZONES[zi]
		checkpoints[myIdx] = { cf = frame(t + 25) * CFrame.new(0, 3.2, 0), zone = zi }

		local label
		if isZoneStart then
			label = string.format("ZONE %d · %s\n%s", zi, string.upper(zone.name), zone.thai)
		else
			label = string.format("CHECKPOINT %d", myIdx)
		end

		buildGate(t, label, zone.accent, function(player)
			local st = playerState[player]
			if st and myIdx > st.progress then
				setProgress(player, myIdx)
				player:SetAttribute("Toast", string.format("✅ เช็คพอยต์ %d/%d · %s", myIdx, FINISH_INDEX, zone.thai))
			end
		end)

		-- แผ่นเสกรถข้างเช็คพอยต์
		local padCF = CFrame.new(frame(t, ROAD_WIDTH / 2 + 12).X, baseY(t, ROAD_WIDTH / 2 + 12) + 0.25,
			frame(t, ROAD_WIDTH / 2 + 12).Z) * frame(t).Rotation
		buildSpawnPad(padCF, "🚗 เสกรถ")
	end

	-- เส้นชัย
	local tFinish = TOTAL - 20
	checkpoints[FINISH_INDEX] = { cf = frame(tFinish) * CFrame.new(0, 3.2, 0), zone = #ZONES }
	buildGate(tFinish, "🏁 FINISH", Color3.fromRGB(255, 255, 255), function(player)
		local st = playerState[player]
		if st and st.progress > 0 and st.progress < FINISH_INDEX then
			local ls = player:FindFirstChild("leaderstats")
			if ls and ls:FindFirstChild("Trips") then
				ls.Trips.Value = ls.Trips.Value + 1
			end
			player:SetAttribute("Toast", "🏁 ถึงปลายทางแล้ว! ทริปสำเร็จ — เริ่มทริปใหม่ได้เลย")
			setProgress(player, 0)
		end
	end)
	-- ลานจอดปลายทาง
	local endF = frame(TOTAL)
	part(roadF, Vector3.new(150, 1, 140), endF * CFrame.new(0, -0.7, -70), Color3.fromRGB(122, 92, 62),
		Enum.Material.Ground)
end

----------------------------------------------------------------------
-- แผ่นบูสต์
----------------------------------------------------------------------
local function applyBoost(player, padCF)
	local car = cars[player]
	if not car or not car.model.Parent then
		return
	end
	local now = os.clock()
	local current = car.model:GetAttribute("BoostUntil") or 0
	if current - now > BOOST_TIME - 0.6 then
		return -- เพิ่งโดนบูสต์ไป
	end
	car.model:SetAttribute("BoostUntil", now + BOOST_TIME)
	local look = padCF.LookVector
	local seat = car.seat
	seat.AssemblyLinearVelocity = seat.AssemblyLinearVelocity + look * 45
end

do
	local k = 0
	for t = 250, TOTAL - 300, BOOST_EVERY do
		k = k + 1
		local lane = ((k % 3) - 1) * 10
		local padCF = frame(t, lane) * CFrame.new(0, 0.15, 0)
		local pad = part(boostF, Vector3.new(12, 0.25, 16), padCF, Color3.fromRGB(10, 25, 45), Enum.Material.Metal)
		pad.Name = "BoostPad"
		pad.CanCollide = false
		for _, zoff in ipairs({ -4, 4 }) do
			for _, s in ipairs({ -1, 1 }) do
				local arm = part(boostF, Vector3.new(1, 0.1, 6.2),
					padCF * CFrame.new(s * 2.1, 0.17, zoff - 0.9) * CFrame.Angles(0, s * math.rad(45), 0),
					Color3.fromRGB(0, 230, 255), Enum.Material.Neon)
				arm.CanCollide = false
			end
		end
		pad.Touched:Connect(function(hit)
			local player = playerFromPart(hit)
			if player and cars[player] and hit:IsDescendantOf(cars[player].model) then
				applyBoost(player, padCF)
			end
		end)
	end
end

----------------------------------------------------------------------
-- ของตกแต่งแต่ละโซน
----------------------------------------------------------------------
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

----------------------------------------------------------------------
-- รถ
----------------------------------------------------------------------
local carColors = {
	Color3.fromRGB(235, 50, 60), Color3.fromRGB(50, 120, 240), Color3.fromRGB(250, 190, 40),
	Color3.fromRGB(60, 200, 110), Color3.fromRGB(240, 120, 200), Color3.fromRGB(240, 240, 245),
}

local function weld(a, b)
	local w = Instance.new("WeldConstraint")
	w.Part0 = a
	w.Part1 = b
	w.Parent = a
end

local function buildCar(cf, player)
	local color = carColors[rng:NextInteger(1, #carColors)]
	local model = Instance.new("Model")
	model.Name = player.Name .. "_Car"
	model:SetAttribute("OwnerUserId", player.UserId)

	local seat = Instance.new("VehicleSeat")
	seat.Name = "Seat"
	seat.Size = Vector3.new(6, 1, 9)
	seat.CFrame = cf
	seat.Color = color
	seat.Material = Enum.Material.SmoothPlastic
	seat.HeadsUpDisplay = false
	seat.MaxSpeed = 0
	seat.Torque = 0
	seat.TurnSpeed = 0
	seat.CustomPhysicalProperties = PhysicalProperties.new(0.8, 0.1, 0, 1, 1)
	seat.Parent = model
	model.PrimaryPart = seat

	local function piece(size, offset, pcolor, material, collide)
		local p = Instance.new("Part")
		p.Size = size
		p.CFrame = cf * offset
		p.Color = pcolor
		p.Material = material or Enum.Material.SmoothPlastic
		p.CanCollide = collide or false
		p.Massless = not collide
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Parent = model
		weld(seat, p)
		return p
	end

	-- ตัวถัง
	piece(Vector3.new(6.4, 1.6, 3.4), CFrame.new(0, 0.9, -3.2), color)
	piece(Vector3.new(6.4, 1.4, 2.6), CFrame.new(0, 0.8, 3.4), color)
	piece(Vector3.new(6.6, 0.6, 0.8), CFrame.new(0, 0.2, -4.9), Color3.fromRGB(30, 30, 35))
	piece(Vector3.new(6.6, 0.6, 0.8), CFrame.new(0, 0.2, 4.9), Color3.fromRGB(30, 30, 35))
	local spoiler = piece(Vector3.new(6.4, 0.4, 1.4), CFrame.new(0, 2.4, 4.4), Color3.fromRGB(30, 30, 35))
	for _, s in ipairs({ -1, 1 }) do
		piece(Vector3.new(0.4, 1.4, 0.8), CFrame.new(s * 2.8, 1.7, 4.4), Color3.fromRGB(30, 30, 35))
		piece(Vector3.new(1.2, 0.5, 0.3), CFrame.new(s * 2.2, 1.0, -4.95), Color3.fromRGB(255, 255, 220), Enum.Material.Neon)
		piece(Vector3.new(1.2, 0.5, 0.3), CFrame.new(s * 2.2, 1.0, 4.75), Color3.fromRGB(255, 40, 40), Enum.Material.Neon)
	end
	spoiler.Name = "Spoiler"
	local glass = piece(Vector3.new(5.6, 0.3, 2.6), CFrame.new(0, 2.0, -1.9) * CFrame.Angles(math.rad(35), 0, 0),
		Color3.fromRGB(150, 210, 255), Enum.Material.Glass)
	glass.Transparency = 0.5

	-- ถ่วงน้ำหนักล่าง ให้รถไม่พลิกง่าย
	local ballast = piece(Vector3.new(4, 0.6, 6), CFrame.new(0, -1.3, 0), Color3.fromRGB(40, 40, 40))
	ballast.Transparency = 1
	ballast.Massless = false
	ballast.CustomPhysicalProperties = PhysicalProperties.new(4, 0.1, 0, 1, 1)

	-- ล้อ
	local motors, steers = {}, {}
	local wheelOffsets = {
		{ -3.6, -1, -3.2, true }, { 3.6, -1, -3.2, true },
		{ -3.6, -1, 3.2, false }, { 3.6, -1, 3.2, false },
	}
	for _, w in ipairs(wheelOffsets) do
		local ox, oy, oz, front = w[1], w[2], w[3], w[4]
		local wheel = Instance.new("Part")
		wheel.Name = "Wheel"
		wheel.Shape = Enum.PartType.Cylinder
		wheel.Size = Vector3.new(1.6, WHEEL_RADIUS * 2, WHEEL_RADIUS * 2)
		wheel.CFrame = cf * CFrame.new(ox, oy, oz)
		wheel.Color = Color3.fromRGB(25, 25, 28)
		wheel.Material = Enum.Material.SmoothPlastic
		wheel.TopSurface = Enum.SurfaceType.Smooth
		wheel.BottomSurface = Enum.SurfaceType.Smooth
		wheel.CustomPhysicalProperties = PhysicalProperties.new(1, 2, 0, 100, 1)
		wheel.Parent = model
		local rim = Instance.new("Part")
		rim.Shape = Enum.PartType.Cylinder
		rim.Size = Vector3.new(1.7, WHEEL_RADIUS * 1.1, WHEEL_RADIUS * 1.1)
		rim.CFrame = wheel.CFrame
		rim.Color = Color3.fromRGB(190, 190, 200)
		rim.Material = Enum.Material.Metal
		rim.CanCollide = false
		rim.Massless = true
		rim.Parent = model
		weld(wheel, rim)

		local wheelAtt = Instance.new("Attachment")
		wheelAtt.Parent = wheel

		local parentPart, parentAttCF
		if front then
			local knuckle = Instance.new("Part")
			knuckle.Name = "Knuckle"
			knuckle.Size = Vector3.new(0.6, 0.6, 0.6)
			knuckle.CFrame = cf * CFrame.new(ox, oy, oz)
			knuckle.Transparency = 1
			knuckle.CanCollide = false
			knuckle.Parent = model

			local sa0 = Instance.new("Attachment")
			sa0.CFrame = CFrame.new(ox, oy, oz) * CFrame.Angles(0, 0, math.pi / 2)
			sa0.Parent = seat
			local sa1 = Instance.new("Attachment")
			sa1.CFrame = CFrame.Angles(0, 0, math.pi / 2)
			sa1.Parent = knuckle
			local servo = Instance.new("HingeConstraint")
			servo.Attachment0 = sa0
			servo.Attachment1 = sa1
			servo.ActuatorType = Enum.ActuatorType.Servo
			servo.ServoMaxTorque = 1e6
			servo.AngularSpeed = 8
			servo.TargetAngle = 0
			servo.LimitsEnabled = true
			servo.LowerAngle = -40
			servo.UpperAngle = 40
			servo.Parent = seat
			table.insert(steers, servo)

			parentPart = knuckle
			parentAttCF = CFrame.new()
		else
			parentPart = seat
			parentAttCF = CFrame.new(ox, oy, oz)
		end

		local pAtt = Instance.new("Attachment")
		pAtt.CFrame = parentAttCF
		pAtt.Parent = parentPart
		local motor = Instance.new("HingeConstraint")
		motor.Attachment0 = pAtt
		motor.Attachment1 = wheelAtt
		motor.ActuatorType = Enum.ActuatorType.Motor
		motor.MotorMaxTorque = 6000
		motor.MotorMaxAcceleration = 120
		motor.AngularVelocity = 0
		motor.Parent = wheel
		table.insert(motors, motor)
	end

	return { model = model, seat = seat, motors = motors, steers = steers, flipTime = 0 }
end

local function destroyCar(player)
	local car = cars[player]
	if car then
		cars[player] = nil
		if car.model then
			car.model:Destroy()
		end
	end
end

function spawnCar(player)
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	local st = playerState[player]
	if not hum or hum.Health <= 0 or not st then
		return
	end
	destroyCar(player)
	local cf = checkpoints[st.progress].cf
	local car = buildCar(cf, player)
	car.model.Parent = carsF
	cars[player] = car
	char:PivotTo(cf * CFrame.new(0, 4, 0))
	car.seat:Sit(hum)
	pcall(function()
		car.seat:SetNetworkOwner(player)
	end)
end

local function resetCar(player, car)
	local st = playerState[player]
	if not st then
		return
	end
	local cf = checkpoints[st.progress].cf
	car.model:PivotTo(cf)
	for _, p in ipairs(car.model:GetDescendants()) do
		if p:IsA("BasePart") then
			p.AssemblyLinearVelocity = Vector3.zero
			p.AssemblyAngularVelocity = Vector3.zero
		end
	end
	car.flipTime = 0
end

-- ควบคุมรถ (รันบน server อ่านค่าจาก VehicleSeat ของคนขับ)
RunService.Heartbeat:Connect(function(dt)
	local now = os.clock()
	for player, car in pairs(cars) do
		local seat = car.seat
		if seat and seat.Parent then
			local throttle = seat.ThrottleFloat
			local steer = seat.SteerFloat
			local boosting = now < (car.model:GetAttribute("BoostUntil") or 0)
			if boosting and throttle >= 0 then
				throttle = 1
			end
			car.model:SetAttribute("Boosting", boosting)

			local maxSpeed = CAR_MAX_SPEED * (boosting and BOOST_MULT or 1)
			if throttle < 0 then
				maxSpeed = CAR_MAX_SPEED * 0.4
			end
			local omega = -throttle * maxSpeed / WHEEL_RADIUS * DRIVE_SIGN
			local torque = throttle ~= 0 and 80000 or 6000
			for _, m in ipairs(car.motors) do
				m.AngularVelocity = omega
				m.MotorMaxTorque = torque
			end

			local speed = seat.AssemblyLinearVelocity.Magnitude
			local maxAngle = 32 * (1 - 0.6 * math.clamp(speed / 150, 0, 1))
			for _, s in ipairs(car.steers) do
				s.TargetAngle = -steer * maxAngle * STEER_SIGN
			end
		end
	end
end)

-- รถตกแมพ / พลิกคว่ำนาน ๆ -> กลับไปเช็คพอยต์
task.spawn(function()
	while true do
		task.wait(0.5)
		for player, car in pairs(cars) do
			local seat = car.seat
			if seat and seat.Parent then
				if seat.Position.Y < -30 then
					resetCar(player, car)
				elseif seat.CFrame.UpVector.Y < 0.25 then
					car.flipTime = car.flipTime + 0.5
					if car.flipTime >= 4 then
						resetCar(player, car)
					end
				else
					car.flipTime = 0
				end
			end
		end
	end
end)

----------------------------------------------------------------------
-- ผู้เล่น
----------------------------------------------------------------------
local function onPlayerAdded(player)
	playerState[player] = { progress = 0 }

	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"
	local cp = Instance.new("IntValue")
	cp.Name = "Checkpoint"
	cp.Parent = ls
	local trips = Instance.new("IntValue")
	trips.Name = "Trips"
	trips.Parent = ls
	ls.Parent = player

	player:SetAttribute("CheckpointTotal", FINISH_INDEX)
	setProgress(player, 0)

	player.CharacterAdded:Connect(function(char)
		local root = char:WaitForChild("HumanoidRootPart", 10)
		local st = playerState[player]
		if root and st and st.progress > 0 then
			task.wait()
			char:PivotTo(checkpoints[st.progress].cf * CFrame.new(0, 4, 0))
		end
	end)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, p in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, p)
end

Players.PlayerRemoving:Connect(function(player)
	destroyCar(player)
	playerState[player] = nil
end)

-- ลบพื้น/จุดเกิดเดิมของเทมเพลต แล้วให้ผู้เล่นเกิดใหม่ที่จุดเกิดของแมพนี้
for _, name in ipairs({ "Baseplate", "SpawnLocation" }) do
	local obj = Workspace:FindFirstChild(name)
	if obj and obj ~= spawn then
		obj:Destroy()
	end
end
for _, pl in ipairs(Players:GetPlayers()) do
	task.spawn(function()
		pl:LoadCharacter()
	end)
end

print(string.format("[RoadTrip] สร้างแมพเสร็จ: ถนนยาว %d studs, %d โซน, %d เช็คพอยต์", TOTAL, #ZONES, FINISH_INDEX))
end, debug.traceback)

if not ok then
	reportError(err)
end
