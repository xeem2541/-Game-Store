-- Car: สร้าง/เสก/รีเซ็ตรถ (ModuleScript ชื่อ Car)
-- รถเป็นแบบ "อาร์เคด": ตัวถังเป็นก้อนเดียวมีล้อกลมไถลไปบนพื้น
-- แรงขับ/เลี้ยว/เกาะถนน คำนวณใน LocalScript ชื่อ CarController (ฝั่งคนขับ)
return function(ctx)
	local Config = ctx.Config
	local C = Config.CAR
	local rng = ctx.Util.rng
	local Workspace = game:GetService("Workspace")
	local cars = {} -- [player] = { model, seat }
	local api = {}

	local colors = {
		Color3.fromRGB(235, 50, 60), Color3.fromRGB(50, 120, 240), Color3.fromRGB(250, 190, 40),
		Color3.fromRGB(60, 200, 110), Color3.fromRGB(240, 120, 200), Color3.fromRGB(240, 240, 245),
	}
	local DARK = Color3.fromRGB(30, 30, 35)

	local function weld(a, b)
		local w = Instance.new("WeldConstraint")
		w.Part0 = a
		w.Part1 = b
		w.Parent = a
	end

	local function build(cf, player)
		local color = colors[rng:NextInteger(1, #colors)]
		local model = Instance.new("Model")
		model.Name = player.Name .. "_Car"
		model:SetAttribute("OwnerUserId", player.UserId)
		model:SetAttribute("MaxSpeed", C.MaxSpeed)
		model:SetAttribute("Accel", C.Accel)
		model:SetAttribute("BrakeAccel", C.BrakeAccel)
		model:SetAttribute("ReverseSpeed", C.ReverseSpeed)
		model:SetAttribute("Grip", C.Grip)
		model:SetAttribute("TurnRate", C.TurnRate)
		model:SetAttribute("BoostMult", C.BoostMult)
		model:SetAttribute("BoostKick", C.BoostKick)
		model:SetAttribute("BoostUntil", 0)
		model:SetAttribute("BoostSerial", 0)

		local seat = Instance.new("VehicleSeat")
		seat.Name = "Seat"
		seat.Size = Vector3.new(6, 1, 9)
		seat.CFrame = cf
		seat.Color = color
		seat.HeadsUpDisplay = false
		seat.MaxSpeed = 0
		seat.Torque = 0
		seat.TurnSpeed = 0
		seat.CustomPhysicalProperties = PhysicalProperties.new(0.8, 0, 0, 100, 0)
		seat.Parent = model
		model.PrimaryPart = seat

		local function piece(size, offset, pcolor, material)
			local p = Instance.new("Part")
			p.Size = size
			p.CFrame = cf * offset
			p.Color = pcolor
			p.Material = material or Enum.Material.SmoothPlastic
			p.CanCollide = false
			p.Massless = true
			p.TopSurface = Enum.SurfaceType.Smooth
			p.BottomSurface = Enum.SurfaceType.Smooth
			p.Parent = model
			weld(seat, p)
			return p
		end

		-- ตัวถัง
		piece(Vector3.new(6.4, 1.6, 3.4), CFrame.new(0, 0.9, -3.2), color)
		piece(Vector3.new(6.4, 1.4, 2.6), CFrame.new(0, 0.8, 3.4), color)
		piece(Vector3.new(6.6, 0.6, 0.8), CFrame.new(0, 0.2, -4.9), DARK)
		piece(Vector3.new(6.6, 0.6, 0.8), CFrame.new(0, 0.2, 4.9), DARK)
		piece(Vector3.new(6.4, 0.4, 1.4), CFrame.new(0, 2.4, 4.4), DARK)
		for _, s in ipairs({ -1, 1 }) do
			piece(Vector3.new(0.4, 1.4, 0.8), CFrame.new(s * 2.8, 1.7, 4.4), DARK)
			piece(Vector3.new(1.2, 0.5, 0.3), CFrame.new(s * 2.2, 1.0, -4.95), Color3.fromRGB(255, 255, 220), Enum.Material.Neon)
			piece(Vector3.new(1.2, 0.5, 0.3), CFrame.new(s * 2.2, 1.0, 4.75), Color3.fromRGB(255, 40, 40), Enum.Material.Neon)
		end
		local glass = piece(Vector3.new(5.6, 0.3, 2.6), CFrame.new(0, 2.0, -1.9) * CFrame.Angles(math.rad(35), 0, 0),
			Color3.fromRGB(150, 210, 255), Enum.Material.Glass)
		glass.Transparency = 0.5

		-- ถ่วงน้ำหนักล่าง ให้ไม่พลิกง่าย
		local ballast = piece(Vector3.new(4, 0.6, 6), CFrame.new(0, -1.3, 0), DARK)
		ballast.Transparency = 1
		ballast.Massless = false
		ballast.CustomPhysicalProperties = PhysicalProperties.new(4, 0, 0, 100, 0)

		-- ล้อ: ลูกบอลโปร่งใสรับน้ำหนัก (ไถลลื่น) + ล้อสวยงามหมุนได้ด้วยโค้ด
		local wheelDefs = {
			{ "FL", -3.4, -1, -3.2, true }, { "FR", 3.4, -1, -3.2, true },
			{ "RL", -3.4, -1, 3.2, false }, { "RR", 3.4, -1, 3.2, false },
		}
		for _, d in ipairs(wheelDefs) do
			local pos = CFrame.new(d[2], d[3], d[4])

			local ball = Instance.new("Part")
			ball.Name = "Skid" .. d[1]
			ball.Shape = Enum.PartType.Ball
			ball.Size = Vector3.new(3, 3, 3)
			ball.CFrame = cf * pos
			ball.Transparency = 1
			ball.CustomPhysicalProperties = PhysicalProperties.new(0.4, 0, 0, 100, 0)
			ball.Parent = model
			weld(seat, ball)

			local wheel = Instance.new("Part")
			wheel.Name = "Wheel" .. d[1]
			wheel.Shape = Enum.PartType.Cylinder
			wheel.Size = Vector3.new(1.6, 3, 3)
			wheel.CFrame = cf * pos
			wheel.Color = Color3.fromRGB(25, 25, 28)
			wheel.CanCollide = false
			wheel.Massless = true
			wheel.Parent = model
			local rim = Instance.new("Part")
			rim.Shape = Enum.PartType.Cylinder
			rim.Size = Vector3.new(1.7, 1.7, 1.7)
			rim.CFrame = wheel.CFrame
			rim.Color = Color3.fromRGB(190, 190, 200)
			rim.Material = Enum.Material.Metal
			rim.CanCollide = false
			rim.Massless = true
			rim.Parent = model
			weld(wheel, rim)

			local w = Instance.new("Weld")
			w.Name = "WheelWeld_" .. d[1]
			w.Part0 = seat
			w.Part1 = wheel
			w.C0 = pos
			w:SetAttribute("Front", d[5])
			w:SetAttribute("Base", pos)
			w.Parent = seat
		end

		-- ตัวรับแรงที่ CarController จะป้อนค่าทุกเฟรม
		local att = Instance.new("Attachment")
		att.Name = "DriveAttachment"
		att.Parent = seat
		local force = Instance.new("VectorForce")
		force.Name = "DriveForce"
		force.Attachment0 = att
		force.RelativeTo = Enum.ActuatorRelativeTo.World
		force.ApplyAtCenterOfMass = true
		force.Force = Vector3.zero
		force.Parent = seat
		local torque = Instance.new("Torque")
		torque.Name = "DriveTorque"
		torque.Attachment0 = att
		torque.RelativeTo = Enum.ActuatorRelativeTo.World
		torque.Torque = Vector3.zero
		torque.Parent = seat

		return { model = model, seat = seat, flipTime = 0 }
	end

	function api.get(player)
		return cars[player]
	end

	function api.destroy(player)
		local car = cars[player]
		if car then
			cars[player] = nil
			car.model:Destroy()
		end
	end

	function api.spawn(player, cf)
		local char = player.Character
		local hum = char and char:FindFirstChildOfClass("Humanoid")
		if not hum or hum.Health <= 0 then
			return
		end
		api.destroy(player)
		local car = build(cf, player)
		car.model.Parent = ctx.F.cars
		cars[player] = car
		char:PivotTo(cf * CFrame.new(0, 4, 0))
		car.seat:Sit(hum)
		pcall(function()
			car.seat:SetNetworkOwner(player)
		end)
		-- ไม่มีคนนั่ง -> ล็อกรถไว้กับที่ (กันไถลลงเนิน), มีคนนั่ง -> ปล่อย
		car.seat:GetPropertyChangedSignal("Occupant"):Connect(function()
			if car.seat.Parent then
				car.seat.Anchored = (car.seat.Occupant == nil)
			end
		end)
	end

	function api.reset(player, cf)
		local car = cars[player]
		if not car or not car.model.Parent then
			return
		end
		pcall(function()
			car.seat:SetNetworkOwner(nil)
		end)
		car.model:PivotTo(cf)
		for _, p in ipairs(car.model:GetDescendants()) do
			if p:IsA("BasePart") then
				p.AssemblyLinearVelocity = Vector3.zero
				p.AssemblyAngularVelocity = Vector3.zero
			end
		end
		car.flipTime = 0
		task.delay(0.25, function()
			if car.seat.Parent and car.seat.Occupant then
				pcall(function()
					car.seat:SetNetworkOwner(player)
				end)
			end
		end)
	end

	function api.boost(player)
		local car = cars[player]
		if not car or not car.model.Parent then
			return
		end
		local now = Workspace:GetServerTimeNow()
		if (car.model:GetAttribute("BoostUntil") or 0) - now > C.BoostTime - 0.6 then
			return
		end
		car.model:SetAttribute("BoostUntil", now + C.BoostTime)
		car.model:SetAttribute("BoostSerial", (car.model:GetAttribute("BoostSerial") or 0) + 1)
	end

	-- รถตกแมพ / พลิกคว่ำนาน -> กลับเช็คพอยต์
	task.spawn(function()
		while true do
			task.wait(0.5)
			for player, car in pairs(cars) do
				if car.seat.Parent then
					if car.seat.Position.Y < -60 then
						api.reset(player, ctx.getCheckpointCF(player))
					elseif car.seat.CFrame.UpVector.Y < 0.25 and car.seat.Occupant then
						car.flipTime = car.flipTime + 0.5
						if car.flipTime >= 4 then
							api.reset(player, ctx.getCheckpointCF(player))
						end
					else
						car.flipTime = 0
					end
				end
			end
		end
	end)

	return api
end
