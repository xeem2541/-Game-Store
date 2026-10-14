-- โมดูล World (ส่วนหนึ่งของ RoadTripBuilder) : ModuleScript ชื่อ World
return function(S)
local Workspace, Lighting, zoneIndexAt, pointAt, frame, part, ZONE_LENGTH, STEP, ROAD_WIDTH, ZONES, TOTAL = S.Workspace, S.Lighting, S.zoneIndexAt, S.pointAt, S.frame, S.part, S.ZONE_LENGTH, S.STEP, S.ROAD_WIDTH, S.ZONES, S.TOTAL

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


S.folder = folder
S.old = old
S.world = world
S.groundF = groundF
S.roadF = roadF
S.gatesF = gatesF
S.boostF = boostF
S.padsF = padsF
S.decorF = decorF
S.carsF = carsF
S.startFrame = startFrame
S.plaza = plaza
S.spawn = spawn
end
